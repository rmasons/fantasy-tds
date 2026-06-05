import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminDb } from '$lib/firebase/admin';
import { fetchLeagueCore, fetchNflState, fetchMatchups, buildRosterInfoMap, combineFpts } from '$lib/sleeper';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';
import { validateLeagueId } from '$lib/server/leagueId';
import { cachedFetch } from '$lib/server/cache';
import type { SeasonRecords, RosterSummary, RecordGame, RecordScore } from '$lib/types';

// Bump when SeasonRecords shape changes to invalidate the Firestore cache.
const SCHEMA_VERSION = 3;

function today(): string {
	return new Date().toISOString().split('T')[0];
}

async function buildRecords(leagueId: string): Promise<SeasonRecords> {
	const [{ league, rosters, users }, nfl] = await Promise.all([
		fetchLeagueCore(leagueId),
		fetchNflState(),
	]);

	const season = league.season;
	const playoffWeekStart: number = league.settings.playoff_week_start ?? 15;

	const ownerIds = rosters.map(r => r.owner_id).filter(Boolean);
	const profiles = await getManagerProfilesBatch(ownerIds);
	const nameOverrides = new Map<string, string>();
	for (const [uid, p] of profiles) {
		if (p.displayName) nameOverrides.set(uid, p.displayName);
	}

	const rosterInfo = buildRosterInfoMap(rosters, users, nameOverrides);

	const rosterSummaries: RosterSummary[] = rosters.map(r => {
		const info = rosterInfo.get(r.roster_id)!;
		return {
			ownerId: r.owner_id,
			teamName: info.teamName,
			ownerName: info.ownerName,
			avatar: info.avatar,
			wins: r.settings?.wins ?? 0,
			losses: r.settings?.losses ?? 0,
			ties: r.settings?.ties ?? 0,
			fpts: combineFpts(r.settings?.fpts, r.settings?.fpts_decimal),
			fptsAgainst: combineFpts(r.settings?.fpts_against, r.settings?.fpts_against_decimal),
		};
	});

	let completedWeeks = 0;
	if (league.status === 'complete') {
		completedWeeks = playoffWeekStart - 1;
	} else if (nfl.season_type === 'regular') {
		completedWeeks = Math.max(0, nfl.display_week - 1);
	} else if (nfl.season_type === 'post') {
		completedWeeks = playoffWeekStart - 1;
	}

	const gameResults: RecordGame[] = [];
	const weekHighs: RecordScore[] = [];
	const weekLows: RecordScore[] = [];

	if (completedWeeks > 0) {
		const weekNums = Array.from({ length: completedWeeks }, (_, i) => i + 1);
		const weekData = await Promise.all(weekNums.map(w => fetchMatchups(leagueId, w)));

		for (let wi = 0; wi < weekData.length; wi++) {
			const week = wi + 1;
			const matchupGroups: Record<number, typeof weekData[0]> = {};

			for (const m of weekData[wi]) {
				if (!matchupGroups[m.matchup_id]) matchupGroups[m.matchup_id] = [];
				matchupGroups[m.matchup_id].push(m);
			}

			for (const pair of Object.values(matchupGroups)) {
				if (pair.length !== 2) continue;
				const [a, b] = pair;
				const aPts = a.points ?? 0;
				const bPts = b.points ?? 0;
				if (aPts === 0 && bPts === 0) continue;

				const [winRoster, losRoster, winPts, losPts] =
					aPts >= bPts
						? [a.roster_id, b.roster_id, aPts, bPts]
						: [b.roster_id, a.roster_id, bPts, aPts];

				gameResults.push({
					season,
					week,
					winner: rosterInfo.get(winRoster)?.teamName ?? `Roster ${winRoster}`,
					loser: rosterInfo.get(losRoster)?.teamName ?? `Roster ${losRoster}`,
					winnerId: rosterInfo.get(winRoster)?.ownerId,
					loserId: rosterInfo.get(losRoster)?.ownerId,
					winnerPts: winPts,
					loserPts: losPts,
					diff: +(winPts - losPts).toFixed(2),
				});
			}

			const weekScores = weekData[wi]
				.filter(m => (m.points ?? 0) > 0)
				.map(m => ({
					team: rosterInfo.get(m.roster_id)?.teamName ?? `Roster ${m.roster_id}`,
					ownerId: rosterInfo.get(m.roster_id)?.ownerId,
					pts: m.points,
				}));

			if (weekScores.length) {
				weekScores.sort((a, b) => b.pts - a.pts);
				const high = weekScores[0];
				const low  = weekScores[weekScores.length - 1];
				weekHighs.push({ season, week, team: high.team, pts: high.pts, ownerId: high.ownerId });
				weekLows.push({ season, week, team: low.team, pts: low.pts, ownerId: low.ownerId });
			}
		}
	}

	return {
		leagueId,
		season,
		status: league.status,
		previousLeagueId: league.previous_league_id,
		playoffWeekStart,
		rosterSummaries,
		gameResults,
		weekHighs,
		weekLows,
	};
}

export const GET: RequestHandler = async ({ params }) => {

	const leagueId = validateLeagueId(params.leagueId);

	// Completed seasons are immutable; in-progress seasons refresh daily.
	const records = await cachedFetch<SeasonRecords>(adminDb().collection('recordsCache').doc(leagueId), {
		schemaVersion: SCHEMA_VERSION,
		isFresh: (env) =>
			env.schemaVersion === SCHEMA_VERSION &&
			(env.value.status === 'complete' || new Date(env.cachedAt).toISOString().split('T')[0] === today()),
		fetcher: () => buildRecords(leagueId),
	});

	// Re-apply current display name overrides on every response so profile
	// changes are reflected immediately even for permanently-cached complete seasons.
	const ownerIds = records.rosterSummaries.map(s => s.ownerId).filter(Boolean);
	if (ownerIds.length) {
		const profiles = await getManagerProfilesBatch(ownerIds);
		const overrides = new Map<string, string>();
		for (const [uid, p] of profiles) {
			if (p.displayName) overrides.set(uid, p.displayName);
		}
		if (overrides.size) {
			for (const s of records.rosterSummaries) {
				if (overrides.has(s.ownerId)) s.teamName = overrides.get(s.ownerId)!;
			}
			for (const g of records.gameResults) {
				if (g.winnerId && overrides.has(g.winnerId)) g.winner = overrides.get(g.winnerId)!;
				if (g.loserId && overrides.has(g.loserId)) g.loser = overrides.get(g.loserId)!;
			}
			for (const h of [...records.weekHighs, ...records.weekLows]) {
				if (h.ownerId && overrides.has(h.ownerId)) h.team = overrides.get(h.ownerId)!;
			}
		}
	}

	return json(records, { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600' } });
};
