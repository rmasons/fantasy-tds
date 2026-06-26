import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserProfile } from '$lib/types';
import { MAX_CLAIMS_PER_USER } from '$lib/eggs';

// ── Fake Firestore ────────────────────────────────────────────────────────
// One doc per leagueId, holding { [eggId]: claim }. Models the subset the
// handler uses: collection().doc(), runTransaction(), and tx.get/tx.set(merge).
type EggDoc = Record<string, { claimedBy: string; displayName: string; claimedAt: string }>;
const store = new Map<string, EggDoc>();

function makeDb() {
	const docRef = (id: string) => ({ id });
	return {
		collection: () => ({ doc: (id: string) => docRef(id) }),
		runTransaction: async (cb: (tx: any) => Promise<void>) => {
			const tx = {
				get: async (ref: { id: string }) => ({
					exists: store.has(ref.id),
					data: () => store.get(ref.id) ?? {},
				}),
				set: (ref: { id: string }, value: EggDoc, opts?: { merge?: boolean }) => {
					const prev = opts?.merge ? (store.get(ref.id) ?? {}) : {};
					store.set(ref.id, { ...prev, ...value });
				},
			};
			await cb(tx);
		},
	};
}

const adminDb = vi.fn(() => makeDb());
vi.mock('$lib/firebase/admin', () => ({ adminDb: () => adminDb() }));

const assertLeagueMember = vi.fn();
vi.mock('$lib/server/membership', () => ({
	assertLeagueMember: (...a: unknown[]) => assertLeagueMember(...a),
}));

const { POST } = await import('./+server');

function user(over: Partial<UserProfile> = {}): UserProfile {
	return {
		uid: 'fb-uid',
		email: 'u@example.com',
		sleeperUserId: 'sleeper-1',
		sleeperUsername: 'user1',
		lastLeagueId: null,
		...over,
	};
}

function event(opts: { user?: UserProfile | null; eggId?: unknown; leagueId?: string }): any {
	return {
		params: { leagueId: opts.leagueId ?? 'L1' },
		locals: { user: 'user' in opts ? opts.user : user() },
		request: { json: async () => ({ eggId: opts.eggId }) },
	};
}

async function status(fn: () => unknown): Promise<number | undefined> {
	try {
		await fn();
	} catch (e) {
		return (e as { status?: number }).status;
	}
	return undefined;
}

beforeEach(() => {
	store.clear();
	vi.clearAllMocks();
	assertLeagueMember.mockResolvedValue(undefined);
});

describe('POST /api/faab-eggs/[leagueId]', () => {
	it('requires authentication (401)', async () => {
		expect(await status(() => POST(event({ user: null, eggId: '1' })))).toBe(401);
	});

	it('rejects an unknown eggId (400)', async () => {
		expect(await status(() => POST(event({ eggId: 'nope' })))).toBe(400);
		expect(await status(() => POST(event({ eggId: 42 })))).toBe(400);
	});

	it('rejects a non-member before touching the store (403)', async () => {
		assertLeagueMember.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 403 }));
		expect(await status(() => POST(event({ eggId: '1' })))).toBe(403);
		expect(store.size).toBe(0);
	});

	it('claims an unclaimed egg and returns 201', async () => {
		const res = await POST(event({ eggId: '1' }));
		expect(res.status).toBe(201);
		await expect(res.json()).resolves.toMatchObject({ won: true });
		expect(store.get('L1')?.['1']?.claimedBy).toBe('sleeper-1');
	});

	it('does not let a second user steal an already-claimed egg (first-come wins)', async () => {
		await POST(event({ eggId: '1', user: user({ sleeperUserId: 'first' }) }));
		const res = await POST(event({ eggId: '1', user: user({ sleeperUserId: 'second' }) }));
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ won: false });
		expect(store.get('L1')?.['1']?.claimedBy).toBe('first');
	});

	it('enforces the per-user claim cap with 409', async () => {
		for (let i = 0; i < MAX_CLAIMS_PER_USER; i++) {
			const res = await POST(event({ eggId: String(i + 1) }));
			expect(res.status).toBe(201);
		}
		// One more egg, same user — should be refused.
		expect(await status(() => POST(event({ eggId: String(MAX_CLAIMS_PER_USER + 1) })))).toBe(409);
	});
});
