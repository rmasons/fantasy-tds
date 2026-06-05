import type { DocumentReference } from 'firebase-admin/firestore';

/** Wrapper persisted in Firestore around any cached payload. */
export interface CacheEnvelope<T> {
	value: T;
	cachedAt: number;        // epoch ms when written
	schemaVersion?: number;  // bump to invalidate older payloads
}

export interface CachedFetchOptions<T> {
	/** Produces a fresh value on cache miss. */
	fetcher: () => Promise<T>;
	/** Max age in ms. Omit for immutable data that never expires on age. */
	ttlMs?: number;
	/** Bump to invalidate everything cached under an older version. */
	schemaVersion?: number;
	/** Skip the read (and the write) — always fetch fresh. */
	bypass?: boolean;
	/**
	 * Custom freshness predicate. When provided it fully replaces the default
	 * ttl/schemaVersion check, letting callers express rules like
	 * "fresh forever once the season is complete".
	 */
	isFresh?: (env: CacheEnvelope<T>) => boolean;
}

function isFreshDefault<T>(env: CacheEnvelope<T>, ttlMs?: number, schemaVersion?: number): boolean {
	if (schemaVersion !== undefined && env.schemaVersion !== schemaVersion) return false;
	if (ttlMs !== undefined && Date.now() - env.cachedAt >= ttlMs) return false;
	return true;
}

/** Fire-and-forget write of a cache envelope. Errors are logged, not thrown. */
export function writeCache<T>(ref: DocumentReference, value: T, schemaVersion?: number): Promise<void> {
	const env: CacheEnvelope<T> = { value, cachedAt: Date.now(), schemaVersion };
	return ref.set(env).then(
		() => {},
		(e) => console.error('[cache] write failed for', ref.path, e)
	);
}

/**
 * Read-through Firestore cache. Returns the cached value when present and fresh,
 * otherwise calls `fetcher`, persists the result, and returns it.
 */
export async function cachedFetch<T>(ref: DocumentReference, opts: CachedFetchOptions<T>): Promise<T> {
	const { fetcher, ttlMs, schemaVersion, bypass = false, isFresh } = opts;

	if (!bypass) {
		try {
			const doc = await ref.get();
			if (doc.exists) {
				const env = doc.data() as CacheEnvelope<T>;
				const fresh = isFresh ? isFresh(env) : isFreshDefault(env, ttlMs, schemaVersion);
				if (fresh && env.value !== undefined) return env.value;
			}
		} catch {
			// cache read failed — fall through to fetcher
		}
	}

	const value = await fetcher();
	if (!bypass) void writeCache(ref, value, schemaVersion);
	return value;
}
