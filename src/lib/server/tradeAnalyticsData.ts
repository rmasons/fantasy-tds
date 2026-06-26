import { cachedFetch, cacheKey } from '$lib/server/cache';
import { fetchLeagueCore, fetchNflState, fetchMatchups, fetchDrafts, buildRosterInfoMap } from '$lib/sleeper';
import { getCachedTransactions, getCachedMatchups, getCachedLeague } from '$lib/server/sleeperCache';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';
import { getPlayers } from '$lib/server/players';
import { getSeasonChain } from '$lib/server/standings';
import { computeTradeAnalytics, aggregateTradeAnalytics } from '$lib/server/tradeAnalytics';
import type { TradeAnalyticsResult } from '$lib/server/tradeAnalytics';
import type { SlimPlayer } from '$lib/types';

// v3: result shape changed from waiverRoi → waiverSteals/waiverBusts. Bump so
// old-shape envelopes (incl. completed seasons that cache indefinitely) are not
// served with empty steals/busts.
const SCHEMA_VERSION = 3;
const LIVE_TTL_MS = 15 * 60 * 1000;

async function buildTradeAnalytics(leagueId: string): Promise<TradeAnalyticsResult> {
	const [{ league, rosters, users }, nfl, allPlayers, drafts] = await Promise.all([
		fetchLeagueCore(leagueId),
		fetchNflState(),
		getPlayers(),
		fetchDrafts(leagueId).catch(() => []),
	]);

	// Cutoff: anything before the draft is pre-season and shouldn't be analyzed
	// (otherwise dynasty pre-draft trades get charged a whole season at week 1).
	const draftStartMs = drafts.reduce((mx, d) => Math.max(mx, d.start_time ?? 0), 0) || undefined;

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

	return computeTradeAnalytics(allTransactions, engineMatchups, rosterInfoMap, players, draftStartMs);
}

/**
 * Read-through cached trade analytics for a single league/season. Shared by the
 * /trades page load (current season, SSR) and the /api/trades/[leagueId]
 * endpoint (season-walk fetches from the client).
 *
 * Completed seasons are immutable, so they're cached indefinitely (no age TTL) —
 * only live seasons expire on LIVE_TTL_MS. This is what keeps past seasons
 * (2024/2023) from re-running a cold ~36-request rebuild every 15 minutes.
 */
export async function getTradeAnalytics(leagueId: string): Promise<TradeAnalyticsResult> {
	const league = await getCachedLeague(leagueId).catch(() => null);
	const complete = league?.status === 'complete';
	return cachedFetch<TradeAnalyticsResult>(cacheKey('tradeAnalyticsCache', leagueId), {
		schemaVersion: SCHEMA_VERSION,
		ttlMs: complete ? undefined : LIVE_TTL_MS,
		fetcher: () => buildTradeAnalytics(leagueId),
	});
}

/**
 * All-time trade analytics across the full season chain. Orchestrates the
 * per-season cached results (so the heavy lifting is already memoized) and
 * aggregates them; waiver steals/busts are pooled across seasons and re-ranked.
 */
export async function getAllTimeTradeAnalytics(leagueId: string): Promise<TradeAnalyticsResult> {
	const chain = await getSeasonChain(leagueId).catch(() => []);
	const seasons = chain.length ? chain : [{ leagueId, season: '' }];

	const perSeason = await Promise.all(
		seasons.map(async (s) => ({
			season: s.season,
			result: await getTradeAnalytics(s.leagueId).catch(() => null),
		})),
	);

	return aggregateTradeAnalytics(
		perSeason
			.filter((p): p is { season: string; result: TradeAnalyticsResult } => p.result !== null)
			.map((p) => ({ season: p.season, result: p.result })),
	);
}
