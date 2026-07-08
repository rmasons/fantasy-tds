/**
 * rivalryDigestData.ts — orchestration for the weekly rivalry digest.
 *
 * Owns the I/O (league, pairings, H2H records) and week selection, then hands
 * off to the pure ranking logic in rivalryDigest.ts. Shared by the
 * /api/rivalry-digest endpoint and the rivalry page's server load so the two
 * can't drift apart.
 */

import { fetchNflState, fetchRosters } from '$lib/sleeper';
import { getCachedLeague, getCachedMatchups } from '$lib/server/sleeperCache';
import { getManagerOptions, getRivalry } from '$lib/server/rivalry';
import { computeRivalryDigest } from '$lib/server/rivalryDigest';
import type { DigestItem, WeeklyPairing } from '$lib/server/rivalryDigest';
import type { RivalryResult } from '$lib/server/rivalry';
import type { SleeperNflState } from '$lib/types';

export interface RivalryDigest {
	week: number;
	digest: DigestItem[];
}

/**
 * The week whose pairings the digest should feature. Sleeper publishes matchup
 * slots for every future scheduled week, so "latest week with data" always
 * lands on the final regular-season week — derive the week from the NFL state
 * instead, the same way the matchups/transactions builders do.
 *
 * - complete season → last regular-season week (the digest is retrospective)
 * - regular season  → current display week, clamped to the regular season
 * - postseason      → last regular-season week
 * - pre/off-season  → week 1 (the first upcoming slate)
 */
export function resolveDigestWeek(
	leagueStatus: string,
	nfl: Pick<SleeperNflState, 'season_type' | 'display_week'>,
	maxRegularWeek: number,
): number {
	if (leagueStatus === 'complete' || nfl.season_type === 'post') return maxRegularWeek;
	if (nfl.season_type === 'regular') {
		return Math.min(Math.max(nfl.display_week, 1), maxRegularWeek);
	}
	return 1;
}

/**
 * Build the digest for a league. Pass `week` to override the featured week
 * (already validated by the caller); omit it to use the current week.
 */
export async function loadRivalryDigest(leagueId: string, week?: number): Promise<RivalryDigest> {
	const [league, managerOptions, rosters] = await Promise.all([
		getCachedLeague(leagueId),
		getManagerOptions(leagueId),
		fetchRosters(leagueId),
	]);

	if (week === undefined) {
		const playoffStart = league.settings?.playoff_week_start ?? 15;
		const nfl = await fetchNflState();
		week = resolveDigestWeek(league.status, nfl, playoffStart - 1);
	}

	// Bypass the cache for the featured week so pairings are always fresh.
	const matchupData = await getCachedMatchups(leagueId, week, true);

	const rosterToOwner = new Map<number, string>(
		rosters.filter((r) => r.owner_id).map((r) => [r.roster_id, r.owner_id])
	);

	// Group matchup entries by matchup_id, then convert roster-level pairings
	// to user-level pairings (skipping byes / ownerless rosters).
	const matchupGroups = new Map<number, number[]>();
	for (const entry of matchupData) {
		const list = matchupGroups.get(entry.matchup_id) ?? [];
		list.push(entry.roster_id);
		matchupGroups.set(entry.matchup_id, list);
	}

	const pairings: WeeklyPairing[] = [];
	for (const [, rosterIds] of matchupGroups) {
		if (rosterIds.length !== 2) continue;
		const [rA, rB] = rosterIds;
		const ownerA = rosterToOwner.get(rA);
		const ownerB = rosterToOwner.get(rB);
		if (!ownerA || !ownerB) continue;
		pairings.push({ managerOneId: ownerA, managerTwoId: ownerB });
	}

	// H2H records for every pairing in parallel; a failed pairing just falls
	// back to the "first meeting" default inside computeRivalryDigest.
	const recordEntries = await Promise.all(
		pairings.map(async (p) => {
			const key = [p.managerOneId, p.managerTwoId].sort().join('_');
			try {
				const record = await getRivalry(leagueId, p.managerOneId, p.managerTwoId);
				return [key, record] as [string, RivalryResult];
			} catch {
				return [key, null] as [string, null];
			}
		})
	);
	const records = new Map<string, RivalryResult>(
		recordEntries.filter((e): e is [string, RivalryResult] => e[1] !== null)
	);

	return { week, digest: computeRivalryDigest(pairings, records, managerOptions) };
}
