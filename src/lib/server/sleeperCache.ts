import { cachedFetch, cacheKey } from '$lib/server/cache';
import type { RawMatchup } from '$lib/sleeper';
import type { SleeperTransaction } from '$lib/types';

async function sleeperGet<T>(url: string): Promise<T> {
	const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
	if (!res.ok) throw new Error(`Sleeper ${res.status}: ${url}`);
	return res.json();
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
