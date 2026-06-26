import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SleeperRoster, UserProfile } from '$lib/types';

// fetchRosters is the single Sleeper dependency; mock it so these tests exercise
// only the membership/ownership logic and never hit the network.
const fetchRosters = vi.fn<(leagueId: string) => Promise<SleeperRoster[]>>();
vi.mock('$lib/sleeper', () => ({
	fetchRosters: (leagueId: string) => fetchRosters(leagueId),
}));

const { assertLeagueMember, getLeagueMemberIds } = await import('./membership');

/** Minimal roster — only the fields membership logic reads. */
function roster(roster_id: number, owner_id: string, co_owners: string[] | null = null): SleeperRoster {
	return {
		roster_id,
		owner_id,
		co_owners,
		players: null,
		starters: null,
		reserve: null,
		settings: {
			wins: 0,
			losses: 0,
			ties: 0,
			fpts: 0,
			fpts_decimal: 0,
			fpts_against: 0,
			fpts_against_decimal: 0,
		},
	};
}

function user(over: Partial<UserProfile> = {}): UserProfile {
	return {
		uid: 'firebase-uid',
		email: 'u@example.com',
		sleeperUserId: 'sleeper-1',
		sleeperUsername: 'user1',
		lastLeagueId: null,
		...over,
	};
}

/** Run an async fn and capture the SvelteKit error status it throws (if any). */
async function status(fn: () => Promise<unknown>): Promise<number | undefined> {
	try {
		await fn();
	} catch (e) {
		return (e as { status?: number }).status;
	}
	return undefined;
}

beforeEach(() => {
	fetchRosters.mockReset();
});

describe('assertLeagueMember', () => {
	it('resolves for an owner of the league', async () => {
		fetchRosters.mockResolvedValue([roster(1, 'sleeper-1'), roster(2, 'other')]);
		await expect(assertLeagueMember(user(), 'L1')).resolves.toBeUndefined();
	});

	it('resolves for a co-owner', async () => {
		fetchRosters.mockResolvedValue([roster(1, 'owner', ['sleeper-1'])]);
		await expect(assertLeagueMember(user(), 'L1')).resolves.toBeUndefined();
	});

	it('throws 401 when the user is null', async () => {
		expect(await status(() => assertLeagueMember(null, 'L1'))).toBe(401);
		expect(fetchRosters).not.toHaveBeenCalled();
	});

	it('throws 400 when the user has no linked Sleeper account', async () => {
		expect(await status(() => assertLeagueMember(user({ sleeperUserId: null }), 'L1'))).toBe(400);
		expect(fetchRosters).not.toHaveBeenCalled();
	});

	it('throws 403 when the user is not in the league', async () => {
		fetchRosters.mockResolvedValue([roster(1, 'someone-else')]);
		expect(await status(() => assertLeagueMember(user(), 'L1'))).toBe(403);
	});

	it('throws 502 when roster lookup fails', async () => {
		fetchRosters.mockRejectedValue(new Error('sleeper down'));
		expect(await status(() => assertLeagueMember(user(), 'L1'))).toBe(502);
	});

	it('enforces ownership of a specific roster when rosterId is given', async () => {
		fetchRosters.mockResolvedValue([roster(1, 'sleeper-1'), roster(2, 'sleeper-1')]);
		await expect(assertLeagueMember(user(), 'L1', 2)).resolves.toBeUndefined();
	});

	it('throws 403 when the user is a member but does not own the given roster', async () => {
		fetchRosters.mockResolvedValue([roster(1, 'sleeper-1'), roster(2, 'someone-else')]);
		expect(await status(() => assertLeagueMember(user(), 'L1', 2))).toBe(403);
	});
});

describe('getLeagueMemberIds', () => {
	it('collects owners and co-owners, de-duplicated', async () => {
		fetchRosters.mockResolvedValue([
			roster(1, 'a', ['b']),
			roster(2, 'c', ['a']), // 'a' appears twice — should collapse
			roster(3, 'd', null),
		]);
		const ids = await getLeagueMemberIds('L1');
		expect([...ids].sort()).toEqual(['a', 'b', 'c', 'd']);
	});

	it('ignores rosters with no owner_id', async () => {
		fetchRosters.mockResolvedValue([roster(1, '', ['solo'])]);
		const ids = await getLeagueMemberIds('L1');
		expect(ids.has('')).toBe(false);
		expect(ids.has('solo')).toBe(true);
	});
});
