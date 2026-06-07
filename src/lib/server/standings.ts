import { adminDb } from '$lib/firebase/admin';
import { cachedFetch } from '$lib/server/cache';
import { fetchLeague, fetchLeagueCore, buildRosterInfoMap, combineFpts } from '$lib/sleeper';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';
import type { StandingRow } from '$lib/types';

const SCHEMA_VERSION = 1;
const LIVE_TTL_MS = 15 * 60 * 1000; // in-progress seasons refresh every 15 min
const CHAIN_TTL_MS = 24 * 60 * 60 * 1000;

export interface StandingsResult {
	season: string;
	status: string;
	standings: StandingRow[];
}

export interface SeasonEntry {
	leagueId: string;
	season: string;
}

async function buildStandings(leagueId: string): Promise<StandingsResult> {
	const { league, rosters, users } = await fetchLeagueCore(leagueId);

	const profiles = await getManagerProfilesBatch(rosters.map((r) => r.owner_id).filter(Boolean));
	const overrides = new Map<string, string>();
	for (const [uid, p] of profiles) if (p.displayName) overrides.set(uid, p.displayName);

	const rosterInfo = buildRosterInfoMap(rosters, users, overrides);

	const standings: StandingRow[] = rosters.map((roster) => {
		const info = rosterInfo.get(roster.roster_id)!;
		return {
			rank: 0,
			rosterId: roster.roster_id,
			teamName: info.teamName,
			ownerName: info.ownerName,
			avatar: info.avatar,
			wins: roster.settings.wins ?? 0,
			losses: roster.settings.losses ?? 0,
			ties: roster.settings.ties ?? 0,
			fpts: combineFpts(roster.settings.fpts, roster.settings.fpts_decimal),
			fptsAgainst: combineFpts(roster.settings.fpts_against, roster.settings.fpts_against_decimal),
			streak: roster.metadata?.streak ?? '–',
		};
	});

	standings.sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);
	standings.forEach((r, i) => (r.rank = i + 1));

	return { season: league.season, status: league.status, standings };
}

export function getStandings(leagueId: string): Promise<StandingsResult> {
	return cachedFetch<StandingsResult>(adminDb().collection('standingsCache').doc(leagueId), {
		schemaVersion: SCHEMA_VERSION,
		isFresh: (env) =>
			env.schemaVersion === SCHEMA_VERSION &&
			(env.value.status === 'complete' || Date.now() - env.cachedAt < LIVE_TTL_MS),
		fetcher: () => buildStandings(leagueId),
	});
}

export function getSeasonChain(leagueId: string): Promise<SeasonEntry[]> {
	return cachedFetch<SeasonEntry[]>(adminDb().collection('seasonChainCache').doc(leagueId), {
		ttlMs: CHAIN_TTL_MS,
		fetcher: async () => {
			const chain: SeasonEntry[] = [];
			let curId: string | null = leagueId;
			while (curId && curId !== '0') {
				try {
					const league = await fetchLeague(curId);
					chain.push({ leagueId: curId, season: league.season });
					curId = league.previous_league_id ?? null;
				} catch {
					break;
				}
			}
			return chain;
		},
	});
}
