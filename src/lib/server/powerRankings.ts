import { cachedFetch, cacheKey } from '$lib/server/cache';
import { fetchLeagueCore, fetchNflState, fetchMatchups, buildRosterInfoMap, combineFpts } from '$lib/sleeper';
import { getCachedMatchups } from '$lib/server/sleeperCache';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';

const SCHEMA_VERSION = 1;
const TTL_MS = 15 * 60 * 1000;

export interface PowerRosterBase {
	rosterId: number;
	teamName: string;
	ownerName: string | null;
	avatar: string | null;
	wins: number;
	losses: number;
	ties: number;
	totalPF: number;
}

// Arrays instead of Maps so the payload is JSON-serializable (the client
// reconstructs the Maps). Power-score + Monte-Carlo computation stays on the
// client because it recomputes as the user scrubs the week navigator.
export interface PowerRankingsData {
	rosterBaseData: PowerRosterBase[];
	weekScores: [number, [number, number][]][]; // week -> [rosterId, points][]
	weekPairs: [number, [number, number][]][]; // week -> matchup pairs
	weekMedians: [number, number][]; // week -> median score
	futureSchedule: [number, number][][];
	currentWeek: number;
	weeksRemaining: number;
	playoffSpots: number;
}

async function buildPowerRankings(leagueId: string): Promise<PowerRankingsData> {
	const [{ league, rosters, users }, nfl] = await Promise.all([fetchLeagueCore(leagueId), fetchNflState()]);

	const playoffStart = league.settings.playoff_week_start ?? 15;
	const playoffSpots = league.settings.playoff_teams ?? 6;

	let completedWeeks = 0;
	if (nfl.season_type === 'regular') completedWeeks = Math.max(0, nfl.display_week - 1);
	else if (nfl.season_type === 'post' || league.status === 'complete') completedWeeks = playoffStart - 1;
	completedWeeks = Math.min(completedWeeks, playoffStart - 1);

	const currentWeek = completedWeeks;
	const weeksRemaining = Math.max(0, playoffStart - 1 - completedWeeks);

	const profiles = await getManagerProfilesBatch(rosters.map((r) => r.owner_id).filter(Boolean));
	const overrides = new Map<string, string>();
	for (const [uid, p] of profiles) if (p.displayName) overrides.set(uid, p.displayName);
	const rosterInfo = buildRosterInfoMap(rosters, users, overrides);

	const rosterBaseData: PowerRosterBase[] = rosters.map((r) => {
		const info = rosterInfo.get(r.roster_id)!;
		return {
			rosterId: r.roster_id,
			teamName: info.teamName,
			ownerName: info.ownerName,
			avatar: info.avatar,
			wins: r.settings.wins ?? 0,
			losses: r.settings.losses ?? 0,
			ties: r.settings.ties ?? 0,
			totalPF: combineFpts(r.settings.fpts, r.settings.fpts_decimal),
		};
	});

	const empty: PowerRankingsData = {
		rosterBaseData,
		weekScores: [],
		weekPairs: [],
		weekMedians: [],
		futureSchedule: [],
		currentWeek,
		weeksRemaining,
		playoffSpots,
	};
	if (completedWeeks === 0) return empty;

	const allWeeks = Array.from({ length: completedWeeks }, (_, i) => i + 1);
	const futureWeeks = Array.from({ length: weeksRemaining }, (_, i) => completedWeeks + 1 + i);

	const [allHist, futureData] = await Promise.all([
		Promise.all(allWeeks.map((w) => getCachedMatchups(leagueId, w))), // completed weeks are immutable
		Promise.all(futureWeeks.map((w) => fetchMatchups(leagueId, w))), // schedule only — fetch live
	]);

	const weekScores: [number, [number, number][]][] = [];
	const weekPairs: [number, [number, number][]][] = [];
	const weekMedians: [number, number][] = [];

	for (let i = 0; i < allWeeks.length; i++) {
		const week = allWeeks[i];
		const wm = new Map<number, number>();
		const groups = new Map<number, number[]>();

		for (const m of allHist[i]) {
			wm.set(m.roster_id, m.points ?? 0);
			if (m.matchup_id != null) {
				if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []);
				groups.get(m.matchup_id)!.push(m.roster_id);
			}
		}

		const sorted = [...wm.values()].filter((p) => p > 0).sort((a, b) => a - b);
		if (sorted.length > 0) {
			const mid = Math.floor(sorted.length / 2);
			const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
			weekMedians.push([week, median]);
		}

		weekScores.push([week, [...wm.entries()]]);
		weekPairs.push([
			week,
			[...groups.values()].filter((p) => p.length === 2).map((p) => [p[0], p[1]] as [number, number]),
		]);
	}

	const futureSchedule: [number, number][][] = futureData.map((weekData) => {
		const groups = new Map<number, number[]>();
		for (const m of weekData) {
			if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []);
			groups.get(m.matchup_id)!.push(m.roster_id);
		}
		return [...groups.values()].filter((p) => p.length === 2).map((p) => [p[0], p[1]] as [number, number]);
	});

	return { rosterBaseData, weekScores, weekPairs, weekMedians, futureSchedule, currentWeek, weeksRemaining, playoffSpots };
}

export async function getPowerRankings(leagueId: string): Promise<PowerRankingsData> {
	// The week maps are encoded as nested arrays, which Firestore can't store,
	// so the cached value is a JSON string.
	const jsonStr = await cachedFetch<string>(cacheKey('powerRankingsCache', leagueId), {
		schemaVersion: SCHEMA_VERSION,
		ttlMs: TTL_MS,
		fetcher: async () => JSON.stringify(await buildPowerRankings(leagueId)),
	});
	return JSON.parse(jsonStr) as PowerRankingsData;
}
