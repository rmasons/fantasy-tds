import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserProfile } from '$lib/types';

// Keep the real PROFILE_MAX_LENGTHS (the validation table under test); only the
// Firestore write is stubbed.
const upsertManagerProfile = vi.fn();
vi.mock('$lib/server/managerProfile', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/managerProfile')>();
	return { ...actual, upsertManagerProfile: (...a: unknown[]) => upsertManagerProfile(...a) };
});

const checkRateLimit = vi.fn();
vi.mock('$lib/server/rateLimit', () => ({
	checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
}));

const { PUT } = await import('./+server');

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

function event(opts: { user?: UserProfile | null; body?: unknown }): any {
	return {
		locals: { user: 'user' in opts ? opts.user : user() },
		request: { json: async () => opts.body },
		getClientAddress: () => '1.2.3.4',
	};
}

async function status(fn: () => unknown): Promise<number | undefined> {
	try {
		const res = await fn();
		// The rate-limit path returns a Response rather than throwing.
		if (res instanceof Response) return res.status;
	} catch (e) {
		return (e as { status?: number }).status;
	}
	return undefined;
}

beforeEach(() => {
	vi.clearAllMocks();
	checkRateLimit.mockResolvedValue(true);
	upsertManagerProfile.mockResolvedValue(undefined);
});

describe('PUT /api/profile', () => {
	it('rejects an unauthenticated request with 401', async () => {
		expect(await status(() => PUT(event({ user: null, body: {} })))).toBe(401);
	});

	it('rejects a user with no linked Sleeper account with 401', async () => {
		expect(await status(() => PUT(event({ user: user({ sleeperUserId: null }), body: {} })))).toBe(401);
	});

	it('returns 429 when rate-limited', async () => {
		checkRateLimit.mockResolvedValueOnce(false);
		expect(await status(() => PUT(event({ body: { bio: 'hi' } })))).toBe(429);
		expect(upsertManagerProfile).not.toHaveBeenCalled();
	});

	it('rejects a field that exceeds its max length with 400', async () => {
		const e = event({ body: { bio: 'x'.repeat(281) } }); // bio max is 280
		expect(await status(() => PUT(e))).toBe(400);
		expect(upsertManagerProfile).not.toHaveBeenCalled();
	});

	it('trims values and drops empty strings to undefined', async () => {
		await PUT(event({ body: { displayName: '  Ace  ', location: '   ' } }));
		expect(upsertManagerProfile).toHaveBeenCalledWith('sleeper-1', {
			displayName: 'Ace',
			location: undefined,
		});
	});

	it('ignores unknown fields not in the allow-list', async () => {
		await PUT(event({ body: { isAdmin: true, sleeperUserId: 'spoof', bio: 'ok' } }));
		expect(upsertManagerProfile).toHaveBeenCalledWith('sleeper-1', { bio: 'ok' });
	});
});
