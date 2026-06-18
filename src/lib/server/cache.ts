import { adminDb } from '$lib/firebase/admin';
import { redis } from '$lib/server/redis';
import { env } from '$env/dynamic/private';

/** Wrapper persisted in the cache around any cached payload. */
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

/**
 * Storage behind the read-through cache. Swappable so the backend (Redis in
 * production, Firestore for rollback, an in-memory fake in tests) can change
 * without touching any caller.
 */
export interface CacheBackend {
	get<T>(key: string): Promise<CacheEnvelope<T> | null>;
	set<T>(key: string, env: CacheEnvelope<T>): Promise<void>;
}

/**
 * Build a cache key. Multi-part keys join with `_` so they map 1:1 onto the
 * Firestore doc ids the old code used (e.g. `${leagueId}_${week}`), keeping the
 * Firestore backend a drop-in fallback.
 */
export function cacheKey(namespace: string, ...parts: Array<string | number>): string {
	return parts.length ? `${namespace}:${parts.join('_')}` : namespace;
}

const redisBackend: CacheBackend = {
	async get<T>(key: string): Promise<CacheEnvelope<T> | null> {
		// Upstash deserializes JSON automatically.
		return (await redis().get<CacheEnvelope<T>>(key)) ?? null;
	},
	async set<T>(key: string, env: CacheEnvelope<T>): Promise<void> {
		await redis().set(key, env);
	},
};

/** Map a `namespace:docId` key back onto a Firestore collection/doc pair. */
function refForKey(key: string) {
	const i = key.indexOf(':');
	const collection = i === -1 ? key : key.slice(0, i);
	const docId = i === -1 ? '_' : key.slice(i + 1);
	return adminDb().collection(collection).doc(docId);
}

const firestoreBackend: CacheBackend = {
	async get<T>(key: string): Promise<CacheEnvelope<T> | null> {
		const doc = await refForKey(key).get();
		return doc.exists ? (doc.data() as CacheEnvelope<T>) : null;
	},
	async set<T>(key: string, env: CacheEnvelope<T>): Promise<void> {
		// Firestore rejects undefined fields; envelopes already omit schemaVersion
		// when undefined (see writeCache), so this is safe.
		await refForKey(key).set(env);
	},
};

let _backend: CacheBackend | null = null;

function backend(): CacheBackend {
	if (_backend) return _backend;
	_backend = env.CACHE_BACKEND === 'firestore' ? firestoreBackend : redisBackend;
	return _backend;
}

/** Override the cache backend (tests, or forcing a specific backend). */
export function setCacheBackend(b: CacheBackend | null): void {
	_backend = b;
}

function isFreshDefault<T>(env: CacheEnvelope<T>, ttlMs?: number, schemaVersion?: number): boolean {
	if (schemaVersion !== undefined && env.schemaVersion !== schemaVersion) return false;
	if (ttlMs !== undefined && Date.now() - env.cachedAt >= ttlMs) return false;
	return true;
}

/** Read the raw envelope without the read-through fetch. Null on miss or error. */
export async function peekCache<T>(key: string): Promise<CacheEnvelope<T> | null> {
	try {
		return await backend().get<T>(key);
	} catch {
		return null;
	}
}

/** Fire-and-forget write of a cache envelope. Errors are logged, not thrown. */
export function writeCache<T>(key: string, value: T, schemaVersion?: number): Promise<void> {
	// Omit schemaVersion entirely when undefined so the Firestore backend stays
	// valid (Firestore rejects undefined field values).
	const env: CacheEnvelope<T> = { value, cachedAt: Date.now() };
	if (schemaVersion !== undefined) env.schemaVersion = schemaVersion;
	return Promise.resolve()
		.then(() => backend().set(key, env))
		.then(
			() => {},
			(e) => console.error('[cache] write failed for', key, e)
		);
}

/**
 * Read-through cache. Returns the cached value when present and fresh, otherwise
 * calls `fetcher`, persists the result, and returns it.
 */
export async function cachedFetch<T>(key: string, opts: CachedFetchOptions<T>): Promise<T> {
	const { fetcher, ttlMs, schemaVersion, bypass = false, isFresh } = opts;

	if (!bypass) {
		try {
			const env = await backend().get<T>(key);
			if (env) {
				const fresh = isFresh ? isFresh(env) : isFreshDefault(env, ttlMs, schemaVersion);
				if (fresh && env.value !== undefined) return env.value;
			}
		} catch {
			// cache read failed — fall through to fetcher
		}
	}

	const value = await fetcher();
	if (!bypass) void writeCache(key, value, schemaVersion);
	return value;
}
