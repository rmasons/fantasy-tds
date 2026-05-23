import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminBucket } from '$lib/firebase/admin';
import { fetchLeagueCore, fetchNflState, fetchMatchups, buildRosterInfoMap, combineFpts } from '$lib/sleeper';
import type { SeasonRecords, RosterSummary, RecordGame, RecordScore } from '$lib/types';

function today(): string {
	return new Date().toISOString().split('T')[0];
}

function cacheKey(leagueId: string): string {
	return `cache/records_${leagueId}.json`;
}

async function buildRecords(leagueId: string): Promise<SeasonRecords> {
	const [{ league, rosters, users }, nfl] = await Promise.all([
		fetchLeagueCore(leagueId),
		fetchNflState(),
	]);

	const season = league.season;
	const playoffWeekStart: number = league.settings.playoff_week_start ?? 15;
	const rosterInfo = buildRosterInfoMap(rosters, users);

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
					winnerPts: winPts,
					loserPts: losPts,
					diff: +(winPts - losPts).toFixed(2),
				});
			}

			const weekScores = weekData[wi]
				.filter(m => (m.points ?? 0) > 0)
				.map(m => ({
					team: rosterInfo.get(m.roster_id)?.teamName ?? `Roster ${m.roster_id}`,
					pts: m.points,
				}));

			if (weekScores.length) {
				weekScores.sort((a, b) => b.pts - a.pts);
				weekHighs.push({ season, week, team: weekScores[0].team, pts: weekScores[0].pts });
				weekLows.push({ season, week, team: weekScores[weekScores.length - 1].team, pts: weekScores[weekScores.length - 1].pts });
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

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });

	const { leagueId } = params;
	const file = adminBucket().file(cacheKey(leagueId));

	try {
		const [metadata] = await file.getMetadata();
		const meta = metadata.metadata as Record<string, string> | undefined;
		if (meta?.status === 'complete' || meta?.date === today()) {
			const [content] = await file.download();
			return json(JSON.parse(content.toString()));
		}
	} catch {
		// cache miss — fall through to Sleeper
	}

	const records = await buildRecords(leagueId);

	try {
		await file.save(JSON.stringify(records), {
			contentType: 'application/json',
			metadata: { status: records.status, date: today() },
		});
	} catch (e) {
		console.error('[records] Failed to write cache:', e);
	}

	return json(records);
};
