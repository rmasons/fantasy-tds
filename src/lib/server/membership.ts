import { error } from '@sveltejs/kit';
import { fetchRosters } from '$lib/sleeper';
import type { UserProfile } from '$lib/types';

/** Set of Sleeper user IDs (owners + co-owners) that belong to a league. */
export async function getLeagueMemberIds(leagueId: string): Promise<Set<string>> {
	const rosters = await fetchRosters(leagueId);
	const ids = new Set<string>();
	for (const r of rosters) {
		if (r.owner_id) ids.add(r.owner_id);
		for (const co of r.co_owners ?? []) ids.add(co);
	}
	return ids;
}

/**
 * Throw unless `user` is a member of `leagueId`. When `rosterId` is given,
 * also require that the user owns (or co-owns) that specific roster.
 */
export async function assertLeagueMember(
	user: UserProfile | null,
	leagueId: string,
	rosterId?: number
): Promise<void> {
	if (!user) throw error(401, 'Unauthorized');
	const sleeperUserId = user.sleeperUserId;
	if (!sleeperUserId) throw error(400, 'Sleeper account not linked');

	let rosters;
	try {
		rosters = await fetchRosters(leagueId);
	} catch {
		throw error(502, 'Failed to verify league membership');
	}

	const owned = rosters.filter(
		(r) => r.owner_id === sleeperUserId || (r.co_owners?.includes(sleeperUserId) ?? false)
	);
	if (owned.length === 0) throw error(403, 'You are not a member of this league');

	if (rosterId !== undefined && !owned.some((r) => r.roster_id === rosterId)) {
		throw error(403, 'You do not own this roster');
	}
}
