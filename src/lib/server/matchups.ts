import { adminDb } from '$lib/firebase/admin';
import { cachedFetch } from '$lib/server/cache';
import {
	fetchLeagueCore,
	fetchNflState,
	fetchMatchups,
	fetchWinnersBracket,
	fetchLosersBracket,
	buildRosterInfoMap,
	type RosterInfo,
} from '$lib/sleeper';
import { getCachedMatchups } from '$lib/server/sleeperCache';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';
import type { SleeperBracketMatch } from '$lib/types';

const META_SCHEMA = 1;
const META_TTL_MS = 5 * 60 * 1000; // current week is live
const BRACKET_SCHEMA = 1;
const BRACKET_TTL_MS = 5 * 60 * 1000;

export interface MatchupsMeta {
	season: string;
	status: string;
	playoffStart: number;
	regularSeasonLength: number;
	maxWeek: number;
	currentWeek: number;
	bracketStartLeagueId: string;
	rosterInfo: Record<string, RosterInfo>; // rosterId -> info; client rebuilds the Map
}

export interface BracketSide {
	rosterId: number | null;
	teamName: string | null;
	avatar: string | null;
	points: number | null;
	won: boolean;
	bye: boolean;
}
export interface BracketMatch {
	round: number;
	matchId: number;
	t1: BracketSide;
	t2: BracketSide;
	label: string;
}
export interface SeasonBracket {
	season: string;
	leagueId: string;
	winnersRounds: BracketMatch[][];
	losersRounds: BracketMatch[][];
}

async function overridesFor(ownerIds: string[]): Promise<Map<string, string>> {
	const profiles = await getManagerProfilesBatch(ownerIds.filter(Boolean));
	const overrides = new Map<string, string>();
	for (const [uid, p] of profiles) if (p.displayName) overrides.set(uid, p.displayName);
	return overrides;
}

async function buildMeta(leagueId: string): Promise<MatchupsMeta> {
	const [{ league, rosters, users }, nfl] = await Promise.all([fetchLeagueCore(leagueId), fetchNflState()]);

	const playoffStart = league.settings?.playoff_week_start ?? 15;
	const pType = league.settings?.playoff_round_type ?? 0;
	const regularSeasonLength = playoffStart - 1;
	const bracketStartLeagueId = league.status === 'pre_draft' || league.status === 'drafting' ? '' : leagueId;

	const overrides = await overridesFor(rosters.map((r) => r.owner_id));
	const rosterInfoMap = buildRosterInfoMap(rosters, users, overrides);

	const playoffTeams = league.settings?.playoff_teams ?? 4;
	const numRounds = Math.ceil(Math.log2(Math.max(playoffTeams, 2)));
	const weeksPerRound = pType === 2 ? 2 : 1;
	const lastPlayoffWeek = playoffStart + numRounds * weeksPerRound - 1;

	let week = 1;
	let maxWeek = 1;
	if (league.status === 'complete') {
		week = lastPlayoffWeek;
		maxWeek = lastPlayoffWeek;
	} else if (nfl.season_type === 'regular') {
		week = Math.min(nfl.display_week, regularSeasonLength);
		maxWeek = week;
	} else if (nfl.season_type === 'post') {
		week = regularSeasonLength;
		maxWeek = lastPlayoffWeek;
	}

	const rosterInfo: Record<string, RosterInfo> = {};
	for (const [rid, info] of rosterInfoMap) rosterInfo[String(rid)] = info;

	return {
		season: league.season,
		status: league.status,
		playoffStart,
		regularSeasonLength,
		maxWeek,
		currentWeek: week,
		bracketStartLeagueId,
		rosterInfo,
	};
}

export function getMatchupsMeta(leagueId: string): Promise<MatchupsMeta> {
	return cachedFetch<MatchupsMeta>(adminDb().collection('matchupsMetaCache').doc(leagueId), {
		schemaVersion: META_SCHEMA,
		isFresh: (env) =>
			env.schemaVersion === META_SCHEMA && (env.value.status === 'complete' || Date.now() - env.cachedAt < META_TTL_MS),
		fetcher: () => buildMeta(leagueId),
	});
}

function roundLabel(r: number, maxR: number, entry: SleeperBracketMatch, losers: boolean): string {
	if (losers) return r === maxR ? 'Toilet Bowl' : `Round ${r}`;
	if (r === maxR) return entry.t1_from?.w != null ? 'Championship' : '3rd Place';
	if (r === maxR - 1) return 'Semifinals';
	return `Round ${r}`;
}

async function buildBracket(leagueId: string): Promise<SeasonBracket[]> {
	const [{ league, rosters, users }, winnersData, losersData] = await Promise.all([
		fetchLeagueCore(leagueId),
		fetchWinnersBracket(leagueId),
		fetchLosersBracket(leagueId),
	]);

	const overrides = await overridesFor(rosters.map((r) => r.owner_id));
	const rosterInfo = buildRosterInfoMap(rosters, users, overrides);

	const pStart = league.settings?.playoff_week_start ?? 15;
	const pType = league.settings?.playoff_round_type ?? 0;
	const pTeams = league.settings?.playoff_teams ?? 4;
	const nRounds = Math.ceil(Math.log2(Math.max(pTeams, 2)));
	const wpr = pType === 2 ? 2 : 1;

	const playoffWeeks: number[] = [];
	for (let r = 0; r < nRounds; r++) for (let w = 0; w < wpr; w++) playoffWeeks.push(pStart + r * wpr + w);

	const complete = league.status === 'complete';
	const weekDataArr = await Promise.all(
		playoffWeeks.map((w) => (complete ? getCachedMatchups(leagueId, w) : fetchMatchups(leagueId, w)).catch(() => []))
	);

	const weekPoints = new Map<number, Map<number, number>>();
	for (let i = 0; i < playoffWeeks.length; i++) {
		const rp = new Map<number, number>();
		for (const m of weekDataArr[i] ?? []) rp.set(m.roster_id, m.points ?? 0);
		weekPoints.set(playoffWeeks[i], rp);
	}

	function getPoints(rosterId: number, round: number): number | null {
		const week = pStart + (round - 1);
		const pts = weekPoints.get(week)?.get(rosterId) ?? null;
		if (pts === null) return null;
		if (pType === 2) return pts + (weekPoints.get(week + 1)?.get(rosterId) ?? 0);
		return pts;
	}

	function teamSide(rosterId: number | null, winnerId: number | null, round: number): BracketSide {
		const info = rosterId ? rosterInfo.get(rosterId) : null;
		return {
			rosterId,
			teamName: info?.teamName ?? (rosterId ? `Team ${rosterId}` : null),
			avatar: info?.avatar ?? null,
			points: rosterId ? getPoints(rosterId, round) : null,
			won: !!rosterId && rosterId === winnerId,
			bye: !rosterId,
		};
	}

	function processBracket(raw: SleeperBracketMatch[], losers: boolean): BracketMatch[][] {
		if (!raw?.length) return [];
		const maxR = Math.max(...raw.map((m) => m.r));
		const byRound: BracketMatch[][] = [];
		for (let r = 1; r <= maxR; r++) {
			byRound.push(
				raw
					.filter((e) => e.r === r)
					.sort((a, b) => a.m - b.m)
					.map((e) => ({
						round: r,
						matchId: e.m,
						t1: teamSide(e.t1 ?? null, e.w ?? null, r),
						t2: teamSide(e.t2 ?? null, e.w ?? null, r),
						label: roundLabel(r, maxR, e, losers),
					}))
			);
		}
		return byRound;
	}

	return [
		{
			season: league.season,
			leagueId,
			winnersRounds: processBracket(winnersData, false),
			losersRounds: processBracket(losersData, true),
		},
	];
}

export function getBracket(leagueId: string): Promise<SeasonBracket[]> {
	return cachedFetch<SeasonBracket[]>(adminDb().collection('matchupsBracketCache').doc(leagueId), {
		schemaVersion: BRACKET_SCHEMA,
		isFresh: (env) => env.schemaVersion === BRACKET_SCHEMA && Date.now() - env.cachedAt < BRACKET_TTL_MS,
		fetcher: () => buildBracket(leagueId),
	});
}
