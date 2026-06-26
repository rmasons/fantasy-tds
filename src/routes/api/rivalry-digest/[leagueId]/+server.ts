import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateLeagueId } from '$lib/server/leagueId';
import { getManagerOptions, getRivalry } from '$lib/server/rivalry';
import { getCachedMatchups, getCachedLeague } from '$lib/server/sleeperCache';
import { fetchRosters } from '$lib/sleeper';
import { computeRivalryDigest } from '$lib/server/rivalryDigest';
import type { WeeklyPairing } from '$lib/server/rivalryDigest';
import type { RivalryResult } from '$lib/server/rivalry';

export const GET: RequestHandler = async ({ params, url }) => {
	const leagueId = validateLeagueId(params.leagueId);

	// Allow caller to override week (defaults to current regular-season week).
	const weekParam = url.searchParams.get('week');

	try {
		// 1. Fetch league metadata and manager options in parallel.
		const [league, managerOptions, rosters] = await Promise.all([
			getCachedLeague(leagueId),
			getManagerOptions(leagueId),
			fetchRosters(leagueId),
		]);

		// 2. Determine which week to use.
		//    If a week is supplied via query param, use it.
		//    Otherwise fall back to the highest week that has matchup data.
		const playoffStart = league.settings?.playoff_week_start ?? 15;
		const maxRegularWeek = playoffStart - 1;

		let week: number;
		if (weekParam) {
			week = parseInt(weekParam, 10);
			if (!Number.isInteger(week) || week < 1 || week > maxRegularWeek) {
				throw error(400, 'Invalid week');
			}
		} else {
			// Probe backward from the last regular-season week to find the most
			// recent one that has matchup data populated.
			week = 1;
			for (let w = maxRegularWeek; w >= 1; w--) {
				try {
					const data = await getCachedMatchups(leagueId, w, true);
					if (data && data.length > 0 && data.some((m) => m.points > 0)) {
						week = w;
						break;
					}
					// Week exists but has no scores yet — could be a future week;
					// keep searching backward.
					if (data && data.length > 0) {
						// matchup slots exist but scores are 0 → this is the current or future week
						week = w;
						break;
					}
				} catch {
					// Week doesn't exist yet — keep going backward
				}
			}
		}

		// 3. Fetch matchup schedule for the chosen week.
		//    Bypass cache for the current week so pairings are always fresh.
		const matchupData = await getCachedMatchups(leagueId, week, true);

		// 4. Build a userId→rosterId map so we can identify pairing partners.
		const rosterToOwner = new Map<number, string>(
			rosters
				.filter((r) => r.owner_id)
				.map((r) => [r.roster_id, r.owner_id])
		);

		// 5. Group matchup entries by matchup_id to find paired rosters.
		const matchupGroups = new Map<number, number[]>();
		for (const entry of matchupData) {
			const list = matchupGroups.get(entry.matchup_id) ?? [];
			list.push(entry.roster_id);
			matchupGroups.set(entry.matchup_id, list);
		}

		// 6. Convert roster-level pairings to user-level pairings.
		const pairings: WeeklyPairing[] = [];
		for (const [, rosterIds] of matchupGroups) {
			if (rosterIds.length !== 2) continue; // skip byes / odd entries
			const [rA, rB] = rosterIds;
			const ownerA = rosterToOwner.get(rA);
			const ownerB = rosterToOwner.get(rB);
			if (!ownerA || !ownerB) continue;
			pairings.push({ managerOneId: ownerA, managerTwoId: ownerB });
		}

		// 7. Fetch H2H records for every pairing in parallel.
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

		// 8. Compute digest.
		const digest = computeRivalryDigest(pairings, records, managerOptions);

		return json({ week, digest }, {
			headers: { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=300' },
		});
	} catch (e: unknown) {
		if (e && typeof e === 'object' && 'status' in e) throw e; // re-throw SvelteKit errors
		console.error('[rivalry-digest] GET failed:', e);
		throw error(502, 'Failed to compute rivalry digest');
	}
};
