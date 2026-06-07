import { describe, it, expect, vi } from 'vitest';
import { cachedFetch, writeCache, type CacheEnvelope } from './cache';

/** Minimal stand-in for a Firestore DocumentReference. */
function mockRef(initial?: CacheEnvelope<unknown>) {
	const store: { doc: CacheEnvelope<unknown> | undefined } = { doc: initial };
	return {
		path: 'mock/doc',
		get: vi.fn(async () => ({
			exists: store.doc !== undefined,
			data: () => store.doc,
		})),
		set: vi.fn(async (v: CacheEnvelope<unknown>) => {
			store.doc = v;
		}),
		_store: store,
	};
}

describe('writeCache', () => {
	it('omits schemaVersion when undefined (Firestore rejects undefined)', async () => {
		const ref = mockRef();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await writeCache(ref as any, { hi: 1 });
		const written = ref.set.mock.calls[0][0];
		expect('schemaVersion' in written).toBe(false);
		expect(written.value).toEqual({ hi: 1 });
		expect(typeof written.cachedAt).toBe('number');
	});

	it('includes schemaVersion when provided', async () => {
		const ref = mockRef();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await writeCache(ref as any, { hi: 1 }, 3);
		expect(ref.set.mock.calls[0][0].schemaVersion).toBe(3);
	});

	it('never throws — a failing set is swallowed and logged', async () => {
		const ref = mockRef();
		ref.set.mockRejectedValueOnce(new Error('boom'));
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		await expect(writeCache(ref as any, { x: 1 })).resolves.toBeUndefined();
		spy.mockRestore();
	});
});

describe('cachedFetch', () => {
	it('returns the fetched value and writes it on a cache miss', async () => {
		const ref = mockRef();
		const fetcher = vi.fn(async () => ['fresh']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const out = await cachedFetch(ref as any, { fetcher });
		expect(out).toEqual(['fresh']);
		expect(fetcher).toHaveBeenCalledOnce();
		// fire-and-forget write — let the microtask settle
		await Promise.resolve();
		expect(ref.set).toHaveBeenCalled();
	});

	it('returns the cached value without calling the fetcher when fresh', async () => {
		const ref = mockRef({ value: ['cached'], cachedAt: Date.now(), schemaVersion: 1 });
		const fetcher = vi.fn(async () => ['fresh']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const out = await cachedFetch(ref as any, { fetcher, schemaVersion: 1, ttlMs: 60_000 });
		expect(out).toEqual(['cached']);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('refetches when the schemaVersion differs', async () => {
		const ref = mockRef({ value: ['old'], cachedAt: Date.now(), schemaVersion: 1 });
		const fetcher = vi.fn(async () => ['new']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const out = await cachedFetch(ref as any, { fetcher, schemaVersion: 2 });
		expect(out).toEqual(['new']);
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it('refetches when the entry is older than the TTL', async () => {
		const ref = mockRef({ value: ['stale'], cachedAt: Date.now() - 10_000, schemaVersion: 1 });
		const fetcher = vi.fn(async () => ['new']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const out = await cachedFetch(ref as any, { fetcher, schemaVersion: 1, ttlMs: 1_000 });
		expect(out).toEqual(['new']);
		expect(fetcher).toHaveBeenCalledOnce();
	});

	it('bypass=true skips both the read and the write', async () => {
		const ref = mockRef({ value: ['cached'], cachedAt: Date.now(), schemaVersion: 1 });
		const fetcher = vi.fn(async () => ['fresh']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const out = await cachedFetch(ref as any, { fetcher, bypass: true });
		expect(out).toEqual(['fresh']);
		expect(ref.get).not.toHaveBeenCalled();
		await Promise.resolve();
		expect(ref.set).not.toHaveBeenCalled();
	});

	it('honors a custom isFresh predicate', async () => {
		const ref = mockRef({ value: { status: 'complete' }, cachedAt: 0, schemaVersion: 1 });
		const fetcher = vi.fn(async () => ({ status: 'rebuilt' }));
		const out = await cachedFetch(ref as any, {
			fetcher,
			schemaVersion: 1,
			// fresh forever once complete, even though cachedAt is ancient
			isFresh: (env) => (env.value as { status: string }).status === 'complete',
		});
		expect(out).toEqual({ status: 'complete' });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('falls back to the fetcher when the read throws', async () => {
		const ref = mockRef();
		ref.get.mockRejectedValueOnce(new Error('read failed'));
		const fetcher = vi.fn(async () => ['recovered']);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const out = await cachedFetch(ref as any, { fetcher });
		expect(out).toEqual(['recovered']);
	});
});
