import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	cachedFetch,
	writeCache,
	peekCache,
	deleteCache,
	cacheKey,
	setCacheBackend,
	type CacheBackend,
	type CacheEnvelope,
} from './cache';

/** In-memory stand-in for the cache backend, with spies on get/set. */
function fakeBackend(initial?: Record<string, CacheEnvelope<unknown>>) {
	const store = new Map<string, CacheEnvelope<unknown>>(Object.entries(initial ?? {}));
	const backend = {
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		set: vi.fn(async (key: string, env: CacheEnvelope<unknown>) => {
			store.set(key, env);
		}),
		del: vi.fn(async (key: string) => {
			store.delete(key);
		}),
	} as unknown as CacheBackend;
	return { backend, store };
}

let store: Map<string, CacheEnvelope<unknown>>;
let backend: CacheBackend;

beforeEach(() => {
	({ backend, store } = fakeBackend());
	setCacheBackend(backend);
});

afterEach(() => {
	setCacheBackend(null); // restore the real (env-selected) backend
	vi.restoreAllMocks();
});

describe('cacheKey', () => {
	it('returns the namespace alone when no parts are given', () => {
		expect(cacheKey('standingsCache')).toBe('standingsCache');
	});

	it('joins multi-part keys with underscores (Firestore doc-id parity)', () => {
		expect(cacheKey('matchupCache', 'L1', 7)).toBe('matchupCache:L1_7');
	});
});

describe('writeCache', () => {
	it('omits schemaVersion when undefined', async () => {
		await writeCache('k', { hi: 1 });
		const written = (backend.set as ReturnType<typeof vi.fn>).mock.calls[0][1];
		expect('schemaVersion' in written).toBe(false);
		expect(written.value).toEqual({ hi: 1 });
		expect(typeof written.cachedAt).toBe('number');
	});

	it('includes schemaVersion when provided', async () => {
		await writeCache('k', { hi: 1 }, 3);
		expect((backend.set as ReturnType<typeof vi.fn>).mock.calls[0][1].schemaVersion).toBe(3);
	});

	it('never throws — a failing set is swallowed and logged', async () => {
		(backend.set as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(writeCache('k', { x: 1 })).resolves.toBeUndefined();
		spy.mockRestore();
	});
});

describe('peekCache', () => {
	it('returns the stored envelope', async () => {
		store.set('k', { value: ['v'], cachedAt: Date.now() });
		expect(await peekCache('k')).toEqual({ value: ['v'], cachedAt: expect.any(Number) });
	});

	it('returns null on miss', async () => {
		expect(await peekCache('missing')).toBeNull();
	});

	it('returns null (not throw) when the backend read fails', async () => {
		(backend.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('down'));
		expect(await peekCache('k')).toBeNull();
	});
});

describe('deleteCache', () => {
	it('evicts the key from the backend', async () => {
		store.set('k', { value: 1, cachedAt: Date.now() });
		await deleteCache('k');
		expect(backend.del).toHaveBeenCalledWith('k');
		expect(store.has('k')).toBe(false);
	});

	it('never throws when the backend delete fails', async () => {
		(backend.del as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(deleteCache('k')).resolves.toBeUndefined();
		spy.mockRestore();
	});
});

describe('cachedFetch', () => {
	it('returns the fetched value and writes it on a cache miss', async () => {
		const fetcher = vi.fn(async () => ['fresh']);
		const out = await cachedFetch('k', { fetcher });
		expect(out).toEqual(['fresh']);
		expect(fetcher).toHaveBeenCalledOnce();
		await Promise.resolve(); // fire-and-forget write
		expect(backend.set).toHaveBeenCalled();
	});

	it('returns the cached value without calling the fetcher when fresh', async () => {
		store.set('k', { value: ['cached'], cachedAt: Date.now(), schemaVersion: 1 });
		const fetcher = vi.fn(async () => ['fresh']);
		const out = await cachedFetch('k', { fetcher, schemaVersion: 1, ttlMs: 60_000 });
		expect(out).toEqual(['cached']);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('refetches when the schemaVersion differs', async () => {
		store.set('k', { value: ['old'], cachedAt: Date.now(), schemaVersion: 1 });
		const fetcher = vi.fn(async () => ['new']);
		const out = await cachedFetch('k', { fetcher, schemaVersion: 2 });
		expect(out).toEqual(['new']);
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it('refetches when the entry is older than the TTL', async () => {
		store.set('k', { value: ['stale'], cachedAt: Date.now() - 10_000, schemaVersion: 1 });
		const fetcher = vi.fn(async () => ['new']);
		const out = await cachedFetch('k', { fetcher, schemaVersion: 1, ttlMs: 1_000 });
		expect(out).toEqual(['new']);
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it('bypass=true skips both the read and the write', async () => {
		store.set('k', { value: ['cached'], cachedAt: Date.now(), schemaVersion: 1 });
		const fetcher = vi.fn(async () => ['fresh']);
		const out = await cachedFetch('k', { fetcher, bypass: true });
		expect(out).toEqual(['fresh']);
		expect(backend.get).not.toHaveBeenCalled();
		await Promise.resolve();
		expect(backend.set).not.toHaveBeenCalled();
	});

	it('honors a custom isFresh predicate', async () => {
		store.set('k', { value: { status: 'complete' }, cachedAt: 0, schemaVersion: 1 });
		const fetcher = vi.fn(async () => ({ status: 'rebuilt' }));
		const out = await cachedFetch('k', {
			fetcher,
			schemaVersion: 1,
			// fresh forever once complete, even though cachedAt is ancient
			isFresh: (env) => (env.value as { status: string }).status === 'complete',
		});
		expect(out).toEqual({ status: 'complete' });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('falls back to the fetcher when the read throws', async () => {
		(backend.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('read failed'));
		const fetcher = vi.fn(async () => ['recovered']);
		const out = await cachedFetch('k', { fetcher });
		expect(out).toEqual(['recovered']);
	});
});
