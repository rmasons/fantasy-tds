import { cachedFetch, cacheKey } from '$lib/server/cache';
import { fetchRosters, fetchUsers, buildRosterInfoMap, combineFpts } from '$lib/sleeper';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';

// v2: team names now respect manager display-name overrides (like every other view).
const SCHEMA_VERSION = 2;
const TTL_MS = 15 * 60 * 1000;

export interface ManagerCard {
	userId: string;
	displayName: string;
	teamName: string;
	avatar: string | null;
	wins: number;
	losses: number;
	ties: number;
	fpts: number;
}

async function buildManagers(leagueId: string): Promise<ManagerCard[]> {
	const [rosters, users] = await Promise.all([fetchRosters(leagueId), fetchUsers(leagueId)]);

	const profiles = await getManagerProfilesBatch(rosters.map((r) => r.owner_id).filter(Boolean));
	const overrides = new Map<string, string>();
	for (const [uid, p] of profiles) if (p.displayName) overrides.set(uid, p.displayName);

	const rosterInfo = buildRosterInfoMap(rosters, users, overrides);

	return rosters
		.filter((r) => r.owner_id)
		.map((r) => {
			const info = rosterInfo.get(r.roster_id)!;
			return {
				userId: r.owner_id,
				displayName: info.ownerName ?? info.teamName,
				teamName: info.teamName,
				avatar: info.avatar,
				wins: r.settings.wins ?? 0,
				losses: r.settings.losses ?? 0,
				ties: r.settings.ties ?? 0,
				fpts: combineFpts(r.settings.fpts, r.settings.fpts_decimal),
			};
		})
		.sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);
}

export function getManagers(leagueId: string): Promise<ManagerCard[]> {
	return cachedFetch<ManagerCard[]>(cacheKey('managersCache', leagueId), {
		schemaVersion: SCHEMA_VERSION,
		ttlMs: TTL_MS,
		fetcher: () => buildManagers(leagueId),
	});
}
