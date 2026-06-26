import type { PageServerLoad } from './$types';
import { getManagerOptions } from '$lib/server/rivalry';
import { getCachedMatchups, getCachedLeague } from '$lib/server/sleeperCache';
import { fetchRosters } from '$lib/sleeper';
import { getRivalry } from '$lib/server/rivalry';
import { computeRivalryDigest } from '$lib/server/rivalryDigest';
import type { WeeklyPairing, DigestItem } from '$lib/server/rivalryDigest';
import type { RivalryResult } from '$lib/server/rivalry';

async function loadDigest(leagueId: string) {
	try {
		const [league, managerOptions, rosters] = await Promise.all([
			getCachedLeague(leagueId),
			getManagerOptions(leagueId),
			fetchRosters(leagueId),
		]);

		const playoffStart = league.settings?.playoff_week_start ?? 15;
		const maxRegularWeek = playoffStart - 1;

		// Find the most recent week with matchup data
		let week = 1;
		for (let w = maxRegularWeek; w >= 1; w--) {
			try {
				const data = await getCachedMatchups(leagueId, w, true);
				if (data && data.length > 0) {
					week = w;
					break;
				}
			} catch {
				// continue backward
			}
		}

		const matchupData = await getCachedMatchups(leagueId, week, true);

		const rosterToOwner = new Map<number, string>(
			rosters
				.filter((r) => r.owner_id)
				.map((r) => [r.roster_id, r.owner_id])
		);

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

		const digest = computeRivalryDigest(pairings, records, managerOptions);
		return { week, digest };
	} catch {
		return null;
	}
}

export const load: PageServerLoad = async ({ params }) => {
	const [managers, digestResult] = await Promise.all([
		getManagerOptions(params.leagueId).catch(() => null),
		loadDigest(params.leagueId),
	]);

	return {
		managers: managers ?? [],
		loadFailed: managers === null,
		digestWeek: digestResult?.week ?? null,
		digest: (digestResult?.digest ?? []) as DigestItem[],
	};
};
