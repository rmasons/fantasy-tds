import { cachedFetch, cacheKey } from '$lib/server/cache';
import type { RawMatchup } from '$lib/sleeper';
import type { SleeperTransaction, SleeperLeague } from '$lib/types';

async function sleeperGet<T>(url: string): Promise<T> {
	const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
	if (!res.ok) throw new Error(`Sleeper ${res.status}: ${url}`);
	return res.json();
}

// League metadata (name, avatar, settings) is read in the league layout on every
// page navigation but changes rarely. A short TTL keeps the hot path off an
// uncached Sleeper round-trip without going stale for long.
const LEAGUE_TTL_MS = 5 * 60 * 1000;

export function getCachedLeague(leagueId: string): Promise<SleeperLeague> {
	return cachedFetch(cacheKey('leagueCache', leagueId), {
		ttlMs: LEAGUE_TTL_MS,
		fetcher: () => sleeperGet<SleeperLeague>(`https://api.sleeper.app/v1/league/${leagueId}`),
	});
}

// Completed weeks are immutable — cache indefinitely.
// Pass bypassCache=true for in-progress seasons so live scores are always fresh.

export function getCachedMatchups(leagueId: string, week: number, bypassCache = false): Promise<RawMatchup[]> {
	return cachedFetch(cacheKey('matchupCache', leagueId, week), {
		bypass: bypassCache,
		fetcher: () => sleeperGet<RawMatchup[]>(`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`),
	});
}

export function getCachedTransactions(leagueId: string, week: number, bypassCache = false): Promise<SleeperTransaction[]> {
	return cachedFetch(cacheKey('transactionCache', leagueId, week), {
		bypass: bypassCache,
		fetcher: () => sleeperGet<SleeperTransaction[]>(`https://api.sleeper.app/v1/league/${leagueId}/transactions/${week}`),
	});
}
