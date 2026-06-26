import { cachedFetch, cacheKey } from '$lib/server/cache';
import { fetchLeagueCore, fetchNflState, fetchMatchups, buildRosterInfoMap } from '$lib/sleeper';
import { getCachedTransactions, getCachedMatchups } from '$lib/server/sleeperCache';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';
import { getPlayers } from '$lib/server/players';
import { computeTradeAnalytics } from '$lib/server/tradeAnalytics';
import type { TradeAnalyticsResult } from '$lib/server/tradeAnalytics';
import type { SlimPlayer } from '$lib/types';

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
	const players: Record<string, SlimPlayer> = {};
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

/**
 * Read-through cached trade analytics for a single league/season. Shared by the
 * /trades page load (current season, SSR) and the /api/trades/[leagueId]
 * endpoint (season-walk fetches from the client).
 */
export function getTradeAnalytics(leagueId: string): Promise<TradeAnalyticsResult> {
	return cachedFetch<TradeAnalyticsResult>(cacheKey('tradeAnalyticsCache', leagueId), {
		schemaVersion: SCHEMA_VERSION,
		// Live seasons refresh on the TTL; the cache is keyed per-leagueId, and each
		// past season is a distinct Sleeper leagueId, so completed seasons stay warm.
		isFresh: (env) =>
			env.schemaVersion === SCHEMA_VERSION && Date.now() - env.cachedAt < LIVE_TTL_MS,
		fetcher: () => buildTradeAnalytics(leagueId),
	});
}
