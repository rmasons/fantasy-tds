import { cachedFetch, cacheKey } from '$lib/server/cache';
import { fetchLeague, fetchRosters, fetchUsers, fetchMatchups, buildRosterInfoMap } from '$lib/sleeper';
import { getCachedMatchups } from '$lib/server/sleeperCache';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';
import type { SleeperLeague, SleeperRoster } from '$lib/types';

// v2: 0–0 (unplayed) matchups are no longer counted as ties — invalidate older
// cached results that may include them.
const SCHEMA_VERSION = 2;
const TTL_MS = 15 * 60 * 1000;

export interface ManagerOption {
	userId: string;
	displayName: string;
	teamName: string;
	avatar: string | null;
}

export interface H2HMatchup {
	season: string;
	week: number;
	teamOne: { points: number };
	teamTwo: { points: number };
}

export interface RivalryResult {
	wins: { one: number; two: number };
	ties: number;
	points: { one: number; two: number };
	matchups: H2HMatchup[];
}

async function buildManagerOptions(leagueId: string): Promise<ManagerOption[]> {
	const [rosters, users] = await Promise.all([fetchRosters(leagueId), fetchUsers(leagueId)]);

	const profiles = await getManagerProfilesBatch(rosters.map((r) => r.owner_id).filter(Boolean));
	const overrides = new Map<string, string>();
	for (const [uid, p] of profiles) if (p.displayName) overrides.set(uid, p.displayName);
	const rosterInfo = buildRosterInfoMap(rosters, users, overrides);

	return rosters
		.filter((r) => r.owner_id)
		.map((r) => {
			const info = rosterInfo.get(r.roster_id)!;
			return {
				userId: r.owner_id,
				displayName: info.ownerName ?? info.teamName,
				teamName: info.teamName,
				avatar: info.avatar,
			};
		})
		.sort((a, b) => a.teamName.localeCompare(b.teamName));
}

export function getManagerOptions(leagueId: string): Promise<ManagerOption[]> {
	return cachedFetch<ManagerOption[]>(cacheKey('rivalryManagersCache', leagueId), {
		schemaVersion: SCHEMA_VERSION,
		ttlMs: TTL_MS,
		fetcher: () => buildManagerOptions(leagueId),
	});
}

async function buildRivalry(leagueId: string, oneId: string, twoId: string): Promise<RivalryResult> {
	const result: RivalryResult = { wins: { one: 0, two: 0 }, ties: 0, points: { one: 0, two: 0 }, matchups: [] };

	let curId: string | null = leagueId;
	let isCurrentSeason = true; // route league = current season → fetch live; past seasons are immutable

	while (curId && curId !== '0') {
		const [league, rosters]: [SleeperLeague, SleeperRoster[]] = await Promise.all([
			fetchLeague(curId),
			fetchRosters(curId),
		]);

		const rOne = rosters.find((r) => r.owner_id === oneId)?.roster_id;
		const rTwo = rosters.find((r) => r.owner_id === twoId)?.roster_id;

		if (rOne && rTwo && rOne !== rTwo) {
			const playoffStart = league.settings?.playoff_week_start ?? 15;
			const weekNums = Array.from({ length: playoffStart - 1 }, (_, i) => i + 1);
			const cid = curId;
			// Only the route league mid-season needs live scores; once complete its
			// weeks are as immutable as any past season's.
			const live = isCurrentSeason && league.status !== 'complete';
			const weekData = await Promise.all(
				weekNums.map((w) => (live ? fetchMatchups(cid, w) : getCachedMatchups(cid, w)))
			);

			for (let i = 0; i < weekData.length; i++) {
				const week = weekNums[i];
				const groups: Record<number, { roster_id: number; points: number }[]> = {};
				for (const m of weekData[i] ?? []) {
					if (m.roster_id === rOne || m.roster_id === rTwo) {
						(groups[m.matchup_id] ??= []).push(m);
					}
				}

				const keys = Object.keys(groups);
				if (keys.length === 1) {
					const pair = groups[parseInt(keys[0])];
					if (pair.length === 2) {
						if (pair[0].roster_id !== rOne) pair.reverse();
						const ptsOne = pair[0].points ?? 0;
						const ptsTwo = pair[1].points ?? 0;

						// 0–0 means scheduled-but-unplayed (Sleeper publishes future
						// weeks with zero scores) — not a real tie. Skip it, matching
						// how the records + superlatives engines treat 0–0 pairs.
						if (ptsOne === 0 && ptsTwo === 0) continue;

						result.points.one += ptsOne;
						result.points.two += ptsTwo;
						if (ptsOne > ptsTwo) result.wins.one++;
						else if (ptsTwo > ptsOne) result.wins.two++;
						else result.ties++;

						result.matchups.push({ season: league.season, week, teamOne: { points: ptsOne }, teamTwo: { points: ptsTwo } });
					}
				}
			}
		}

		curId = league.previous_league_id ?? null;
		isCurrentSeason = false;
	}

	result.matchups.sort((a, b) => parseInt(b.season) - parseInt(a.season) || b.week - a.week);
	return result;
}

export function getRivalry(leagueId: string, oneId: string, twoId: string): Promise<RivalryResult> {
	return cachedFetch<RivalryResult>(cacheKey('rivalryCache', leagueId, oneId, twoId), {
		schemaVersion: SCHEMA_VERSION,
		ttlMs: TTL_MS,
		fetcher: () => buildRivalry(leagueId, oneId, twoId),
	});
}
