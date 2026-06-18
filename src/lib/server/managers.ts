import { cachedFetch, cacheKey } from '$lib/server/cache';
import { fetchRosters, fetchUsers, buildRosterInfoMap, combineFpts } from '$lib/sleeper';

const SCHEMA_VERSION = 1;
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
	const rosterInfo = buildRosterInfoMap(rosters, users);

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
