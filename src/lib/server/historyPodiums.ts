import { cachedFetch, cacheKey } from '$lib/server/cache';
import { fetchLeague, fetchLeagueCore, fetchWinnersBracket, fetchLosersBracket, buildRosterInfoMap } from '$lib/sleeper';

const SCHEMA_VERSION = 1;
const TTL_MS = 60 * 60 * 1000; // podiums only change when a season completes

export interface ManagerEntry {
	rosterId: number;
	ownerId: string;
	teamName: string;
	ownerName: string;
	avatar: string | null;
}

export interface Podium {
	season: string;
	champion: ManagerEntry;
	second: ManagerEntry | null;
	third: ManagerEntry | null;
	toilet: ManagerEntry | null;
}

export interface HistoryPodiums {
	podiums: Podium[];
	seasonLidMap: Record<string, string>;
}

async function buildPodiums(leagueId: string): Promise<HistoryPodiums> {
	const current = await fetchLeague(leagueId);
	let curId: string | null = current.status === 'complete' ? current.league_id : current.previous_league_id;

	const podiums: Podium[] = [];
	const seasonLidMap: Record<string, string> = {};

	while (curId && curId !== '0') {
		const [{ league, rosters, users }, winners, losers] = await Promise.all([
			fetchLeagueCore(curId),
			fetchWinnersBracket(curId),
			fetchLosersBracket(curId),
		]);

		const rosterInfo = buildRosterInfoMap(rosters, users);

		const toEntry = (rid: number): ManagerEntry => {
			const info = rosterInfo.get(rid);
			return {
				rosterId: rid,
				ownerId: info?.ownerId ?? '',
				teamName: info?.teamName ?? `Team ${rid}`,
				ownerName: info?.ownerName ?? info?.teamName ?? `Team ${rid}`,
				avatar: info?.avatar ?? null,
			};
		};

		const wb = Array.isArray(winners) ? winners : [];
		const lb = Array.isArray(losers) ? losers : [];

		if (wb.length > 0) {
			const playoffRounds = Math.max(...wb.map((m) => m.r));
			const toiletRounds = lb.length ? Math.max(...lb.map((m) => m.r)) : 0;

			const finalsMatch = wb.find((m) => m.r === playoffRounds && m.t1_from?.w != null);
			const runnersUpMatch = wb.find((m) => m.r === playoffRounds && m.t1_from?.l != null);
			const toiletMatch = lb.length
				? lb.find((m) => m.r === toiletRounds && (!m.t1_from || m.t1_from?.w != null))
				: null;

			if (finalsMatch?.w) {
				podiums.push({
					season: league.season,
					champion: toEntry(finalsMatch.w),
					second: finalsMatch.l ? toEntry(finalsMatch.l) : null,
					third: runnersUpMatch?.w ? toEntry(runnersUpMatch.w) : null,
					toilet: toiletMatch?.w ? toEntry(toiletMatch.w) : null,
				});
			}
		}

		seasonLidMap[league.season] = curId;
		curId = league.previous_league_id ?? null;
	}

	return { podiums, seasonLidMap };
}

export function getHistoryPodiums(leagueId: string): Promise<HistoryPodiums> {
	return cachedFetch<HistoryPodiums>(cacheKey('historyPodiumsCache', leagueId), {
		schemaVersion: SCHEMA_VERSION,
		ttlMs: TTL_MS,
		fetcher: () => buildPodiums(leagueId),
	});
}
