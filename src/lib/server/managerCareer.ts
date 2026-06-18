import { cachedFetch, cacheKey } from '$lib/server/cache';
import { fetchLeague, fetchUsers, fetchRosters, fetchWinnersBracket, buildRosterInfoMap, combineFpts } from '$lib/sleeper';
import type { SleeperBracketMatch, SleeperLeague, SleeperLeagueUser, SleeperRoster } from '$lib/types';

const SCHEMA_VERSION = 1;
const TTL_MS = 15 * 60 * 1000;

export type PlayoffFinish = 'champion' | 'runner-up' | '3rd' | 'playoffs' | null;

export interface SeasonStat {
	season: string;
	teamName: string;
	wins: number;
	losses: number;
	ties: number;
	fpts: number;
	fptsAgainst: number;
	rosterId: number;
	playoffFinish: PlayoffFinish;
}

export interface ManagerInfo {
	ownerId: string;
	displayName: string;
	teamName: string;
	avatar: string | null;
}

export interface ManagerCareer {
	manager: ManagerInfo | null;
	seasons: SeasonStat[];
}

function getPlayoffFinish(rosterId: number, winners: SleeperBracketMatch[]): PlayoffFinish {
	if (!winners?.length) return null;
	const appearsInWinners = winners.some((e) => e.t1 === rosterId || e.t2 === rosterId);
	if (!appearsInWinners) return null;

	const maxR = Math.max(...winners.map((e) => e.r));
	const lastRound = Math.max(...winners.filter((e) => e.t1 === rosterId || e.t2 === rosterId).map((e) => e.r));

	if (lastRound < maxR) return 'playoffs';

	const finalMatch = winners.find((e) => e.r === maxR && (e.t1 === rosterId || e.t2 === rosterId));
	if (!finalMatch) return 'playoffs';

	// Sleeper puts both the championship and the 3rd-place game in the final round.
	// The championship slot is seeded by a semi win (t1_from.w); 3rd place by a loss.
	const isChampionship = finalMatch.t1_from?.w != null;
	if (!isChampionship) return finalMatch.w === rosterId ? '3rd' : 'playoffs';
	return finalMatch.w === rosterId ? 'champion' : 'runner-up';
}

async function buildCareer(leagueId: string, userId: string): Promise<ManagerCareer> {
	let curId: string | null = leagueId;
	let manager: ManagerInfo | null = null;
	const seasons: SeasonStat[] = [];

	while (curId && curId !== '0') {
		const [league, users, rosters, winners]: [SleeperLeague, SleeperLeagueUser[], SleeperRoster[], SleeperBracketMatch[]] =
			await Promise.all([
				fetchLeague(curId),
				fetchUsers(curId),
				fetchRosters(curId),
				fetchWinnersBracket(curId).catch(() => [] as SleeperBracketMatch[]),
			]);

		const rosterInfo = buildRosterInfoMap(rosters, users);
		const roster = rosters.find((r) => r.owner_id === userId);

		if (roster) {
			const info = rosterInfo.get(roster.roster_id)!;
			if (!manager) {
				manager = {
					ownerId: userId,
					displayName: info.ownerName ?? info.teamName,
					teamName: info.teamName,
					avatar: info.avatar,
				};
			}
			seasons.push({
				season: league.season,
				teamName: info.teamName,
				wins: roster.settings?.wins ?? 0,
				losses: roster.settings?.losses ?? 0,
				ties: roster.settings?.ties ?? 0,
				fpts: combineFpts(roster.settings?.fpts, roster.settings?.fpts_decimal),
				fptsAgainst: combineFpts(roster.settings?.fpts_against, roster.settings?.fpts_against_decimal),
				rosterId: roster.roster_id,
				playoffFinish: getPlayoffFinish(roster.roster_id, winners),
			});
		}

		curId = league.previous_league_id ?? null;
	}

	return { manager, seasons };
}

export function getManagerCareer(leagueId: string, userId: string): Promise<ManagerCareer> {
	return cachedFetch<ManagerCareer>(cacheKey('managerCareerCache', leagueId, userId), {
		schemaVersion: SCHEMA_VERSION,
		ttlMs: TTL_MS,
		fetcher: () => buildCareer(leagueId, userId),
	});
}
