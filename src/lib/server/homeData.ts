import { cachedFetch, cacheKey } from '$lib/server/cache';
import {
	fetchLeague,
	fetchNflState,
	fetchUsers,
	fetchRosters,
	fetchWinnersBracket,
	buildRosterInfoMap,
	combineFpts,
} from '$lib/sleeper';
import { getCachedMatchups } from '$lib/server/sleeperCache';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';
import type { SleeperLeague, SleeperNflState } from '$lib/types';

const SCHEMA_VERSION = 1;
const TTL_MS = 5 * 60 * 1000; // standings + current-week scores are live

export interface Champion {
	teamName: string;
	ownerName: string | null;
	avatar: string | null;
	season: string;
}

export interface StandingMini {
	rank: number;
	teamName: string;
	ownerName: string | null;
	avatar: string | null;
	wins: number;
	losses: number;
	fpts: number;
}

export interface MatchupWidget {
	matchupId: number;
	teams: { teamName: string; avatar: string | null; points: number }[];
}

export interface HomeData {
	league: SleeperLeague;
	nflState: SleeperNflState;
	champion: Champion | null;
	standingsMini: StandingMini[];
	weekMatchups: MatchupWidget[];
}

async function overridesFor(ownerIds: string[]): Promise<Map<string, string>> {
	const profiles = await getManagerProfilesBatch(ownerIds.filter(Boolean));
	const overrides = new Map<string, string>();
	for (const [uid, p] of profiles) if (p.displayName) overrides.set(uid, p.displayName);
	return overrides;
}

async function fetchChampion(prevLeagueId: string): Promise<Champion | null> {
	try {
		const [prevLeague, users, rosters, winners] = await Promise.all([
			fetchLeague(prevLeagueId),
			fetchUsers(prevLeagueId),
			fetchRosters(prevLeagueId),
			fetchWinnersBracket(prevLeagueId),
		]);
		if (!Array.isArray(winners) || winners.length === 0) return null;

		const overrides = await overridesFor(rosters.map((r) => r.owner_id));
		const rosterInfo = buildRosterInfoMap(rosters, users, overrides);

		const maxRound = Math.max(...winners.map((m) => m.r));
		const finalsMatch = winners.find((m) => m.r === maxRound && m.t1_from?.w != null);
		if (!finalsMatch?.w) return null;

		const info = rosterInfo.get(finalsMatch.w);
		return {
			teamName: info?.teamName ?? `Team ${finalsMatch.w}`,
			ownerName: info?.ownerName ?? null,
			avatar: info?.avatar ?? null,
			season: prevLeague.season,
		};
	} catch {
		return null;
	}
}

async function buildHome(leagueId: string): Promise<HomeData> {
	const [league, nflState] = await Promise.all([fetchLeague(leagueId), fetchNflState()]);

	const prevId = league.previous_league_id ?? '';
	const [champion, rosters, users] = await Promise.all([
		prevId && prevId !== '0' ? fetchChampion(prevId) : Promise.resolve(null),
		fetchRosters(leagueId),
		fetchUsers(leagueId),
	]);

	const overrides = await overridesFor(rosters.map((r) => r.owner_id));
	const rosterInfo = buildRosterInfoMap(rosters, users, overrides);

	const standingsMini: StandingMini[] = rosters.map((r) => {
		const info = rosterInfo.get(r.roster_id)!;
		return {
			rank: 0,
			teamName: info.teamName,
			ownerName: info.ownerName,
			avatar: info.avatar,
			wins: r.settings.wins ?? 0,
			losses: r.settings.losses ?? 0,
			fpts: combineFpts(r.settings.fpts, r.settings.fpts_decimal),
		};
	});
	standingsMini.sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);
	standingsMini.forEach((r, i) => (r.rank = i + 1));

	let weekMatchups: MatchupWidget[] = [];
	if (nflState.season_type === 'regular') {
		const raw = await getCachedMatchups(leagueId, nflState.week, true).catch(() => []);
		const groups = new Map<number, { teamName: string; avatar: string | null; points: number }[]>();
		for (const m of raw) {
			if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []);
			const info = rosterInfo.get(m.roster_id);
			groups.get(m.matchup_id)!.push({
				teamName: info?.teamName ?? `Team ${m.roster_id}`,
				avatar: info?.avatar ?? null,
				points: m.points ?? 0,
			});
		}
		weekMatchups = [...groups.entries()]
			.filter(([, pair]) => pair.length === 2)
			.map(([mid, teams]) => ({ matchupId: mid, teams }))
			.sort((a, b) => a.matchupId - b.matchupId);
	}

	return { league, nflState, champion, standingsMini, weekMatchups };
}

export function getHomeData(leagueId: string): Promise<HomeData> {
	return cachedFetch<HomeData>(cacheKey('homeDataCache', leagueId), {
		schemaVersion: SCHEMA_VERSION,
		ttlMs: TTL_MS,
		fetcher: () => buildHome(leagueId),
	});
}
