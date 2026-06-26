import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserProfile } from '$lib/types';

// Data layer + membership are mocked so these tests exercise only the handler's
// auth ordering and input validation, never Firestore or Sleeper.
const setKeeperSelection = vi.fn();
const clearKeeperSelection = vi.fn();
const getKeeperSelections = vi.fn();
vi.mock('$lib/server/keepers', () => ({
	getKeeperSelections: (...a: unknown[]) => getKeeperSelections(...a),
	setKeeperSelection: (...a: unknown[]) => setKeeperSelection(...a),
	clearKeeperSelection: (...a: unknown[]) => clearKeeperSelection(...a),
}));

const assertLeagueMember = vi.fn();
vi.mock('$lib/server/membership', () => ({
	assertLeagueMember: (...a: unknown[]) => assertLeagueMember(...a),
}));

const { PUT, DELETE } = await import('./+server');

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

/** Minimal RequestEvent stand-in for these handlers. */
function event(opts: {
	user?: UserProfile | null;
	query?: Record<string, string>;
	body?: unknown;
}): any {
	const url = new URL('http://x/api/keeper-selections');
	for (const [k, v] of Object.entries(opts.query ?? { leagueId: 'L1' })) {
		url.searchParams.set(k, v);
	}
	return {
		url,
		locals: { user: 'user' in opts ? opts.user : user() },
		request: { json: async () => opts.body },
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
	vi.clearAllMocks();
	setKeeperSelection.mockResolvedValue({ rosterId: 1, playerIds: ['p1'] });
	clearKeeperSelection.mockResolvedValue(undefined);
	assertLeagueMember.mockResolvedValue(undefined);
});

describe('PUT /api/keeper-selections', () => {
	it('rejects an unauthenticated request with 401', async () => {
		expect(await status(() => PUT(event({ user: null, body: {} })))).toBe(401);
	});

	it('rejects a user with no linked Sleeper account with 400', async () => {
		const e = event({ user: user({ sleeperUserId: null }), body: { rosterId: 1, playerIds: [] } });
		expect(await status(() => PUT(e))).toBe(400);
	});

	it('rejects a missing/non-numeric rosterId with 400', async () => {
		expect(await status(() => PUT(event({ body: { playerIds: [] } })))).toBe(400);
		expect(await status(() => PUT(event({ body: { rosterId: '1', playerIds: [] } })))).toBe(400);
	});

	it('rejects malformed playerIds with 400', async () => {
		expect(await status(() => PUT(event({ body: { rosterId: 1, playerIds: 'nope' } })))).toBe(400);
		expect(await status(() => PUT(event({ body: { rosterId: 1, playerIds: [123] } })))).toBe(400);
		expect(await status(() => PUT(event({ body: { rosterId: 1, playerIds: ['bad id!'] } })))).toBe(400);
	});

	it('enforces roster ownership via assertLeagueMember before writing', async () => {
		assertLeagueMember.mockRejectedValueOnce(Object.assign(new Error('not owner'), { status: 403 }));
		const e = event({ body: { rosterId: 7, playerIds: ['p1'] } });
		expect(await status(() => PUT(e))).toBe(403);
		expect(assertLeagueMember).toHaveBeenCalledWith(expect.anything(), 'L1', 7);
		expect(setKeeperSelection).not.toHaveBeenCalled();
	});

	it('writes the selection and returns ok on the happy path', async () => {
		const e = event({ body: { rosterId: 3, playerIds: ['p1', 'p2'] } });
		const res = await PUT(e);
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toMatchObject({ ok: true });
		expect(setKeeperSelection).toHaveBeenCalledWith('L1', 'sleeper-1', 3, ['p1', 'p2']);
	});
});

describe('DELETE /api/keeper-selections', () => {
	it('rejects an unauthenticated request with 401', async () => {
		expect(await status(() => DELETE(event({ user: null })))).toBe(401);
	});

	it('clears the caller\'s own selection by default', async () => {
		await DELETE(event({}));
		expect(clearKeeperSelection).toHaveBeenCalledWith('L1', 'sleeper-1');
	});

	it('lets an admin clear another user\'s selection via ?userId', async () => {
		await DELETE(event({ user: user({ isAdmin: true }), query: { leagueId: 'L1', userId: 'other' } }));
		expect(clearKeeperSelection).toHaveBeenCalledWith('L1', 'other');
	});

	it('ignores ?userId for a non-admin and clears their own', async () => {
		await DELETE(event({ user: user({ isAdmin: false }), query: { leagueId: 'L1', userId: 'other' } }));
		expect(clearKeeperSelection).toHaveBeenCalledWith('L1', 'sleeper-1');
	});
});
