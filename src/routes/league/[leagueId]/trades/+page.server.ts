import type { PageServerLoad } from './$types';
import { cachedFetch, cacheKey } from '$lib/server/cache';
import { fetchLeagueCore, fetchNflState, fetchMatchups, buildRosterInfoMap } from '$lib/sleeper';
import { getCachedTransactions, getCachedMatchups } from '$lib/server/sleeperCache';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';
import { getPlayers } from '$lib/server/players';
import { computeTradeAnalytics } from '$lib/server/tradeAnalytics';
import { getSeasonChain } from '$lib/server/standings';
import type { TradeAnalyticsResult } from '$lib/server/tradeAnalytics';

const SCHEMA_VERSION = 1;
const LIVE_TTL_MS = 15 * 60 * 1000;

async function buildTradeAnalytics(leagueId: string): Promise<TradeAnalyticsResult> {
	const [{ league, rosters, users }, nfl, allPlayers] = await Promise.all([
		fetchLeagueCore(leagueId),
		fetchNflState(),
		getPlayers(),
	]);

	const profiles = await getManagerProfilesBatch(rosters.map((r) => r.owner_id).filter(Boolean));
	const overrides = new Map<string, string>();
	for (const [uid, p] of profiles) if (p.displayName) overrides.set(uid, p.displayName);
	const rosterInfoMap = buildRosterInfoMap(rosters, users, overrides);

	// Determine the last week with data
	let week: number;
	if (league.status === 'complete') {
		week = 18;
	} else {
		week = nfl.season_type === 'regular' ? nfl.week : nfl.season_type === 'post' ? 18 : 1;
		week = Math.max(week, 1);
	}

	const liveFrom = league.status === 'complete' ? Infinity : nfl.week;
	const weekNums = Array.from({ length: week }, (_, i) => i + 1);

	// Fetch transactions and matchups for all weeks in parallel
	const [txWeeks, matchupWeeks] = await Promise.all([
		Promise.all(
			weekNums.map((w) =>
				w < liveFrom ? getCachedTransactions(leagueId, w) : getCachedTransactions(leagueId, w, true),
			),
		),
		Promise.all(
			weekNums.map((w) =>
				w < liveFrom ? getCachedMatchups(leagueId, w) : fetchMatchups(leagueId, w),
			),
		),
	]);

	const allTransactions = txWeeks.flat();

	// Build the subset of players referenced by transactions
	const referenced = new Set<string>();
	for (const tx of allTransactions) {
		for (const pid of Object.keys(tx.adds ?? {})) referenced.add(pid);
		for (const pid of Object.keys(tx.drops ?? {})) referenced.add(pid);
	}
	const players: Record<string, import('$lib/types').SlimPlayer> = {};
	for (const id of referenced) if (allPlayers[id]) players[id] = allPlayers[id];

	// matchupWeeks used by the engine — normalise to the engine's expected shape
	const engineMatchups = matchupWeeks.map((week) =>
		week.map((m) => ({
			roster_id: m.roster_id,
			starters: m.starters ?? [],
			players_points: m.players_points ?? {},
		})),
	);

	return computeTradeAnalytics(allTransactions, engineMatchups, rosterInfoMap, players);
}

function getTradeAnalytics(leagueId: string): Promise<TradeAnalyticsResult> {
	return cachedFetch<TradeAnalyticsResult>(cacheKey('tradeAnalyticsCache', leagueId), {
		schemaVersion: SCHEMA_VERSION,
		isFresh: (env) => {
			if (env.schemaVersion !== SCHEMA_VERSION) return false;
			// Once a season is complete the data is immutable — never re-fetch.
			// We detect this by checking if we have trades (a completed season will
			// have been processed) and the league status was captured at build time.
			// For live seasons use the TTL.
			return Date.now() - env.cachedAt < LIVE_TTL_MS;
		},
		fetcher: () => buildTradeAnalytics(leagueId),
	});
}

export const load: PageServerLoad = async ({ params }) => {
	const [data, seasons] = await Promise.all([
		getTradeAnalytics(params.leagueId).catch(() => null),
		getSeasonChain(params.leagueId).catch(() => []),
	]);

	return {
		leagueId: params.leagueId,
		analytics: data,
		seasons,
		loadFailed: data === null,
	};
};
