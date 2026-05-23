import type { SleeperLeague, SleeperLeagueUser, SleeperNflState, SleeperRoster } from './types';

const BASE = 'https://api.sleeper.app/v1';

// ── Shared types ──────────────────────────────────────────────────────────────

export interface RosterInfo {
	teamName: string;
	ownerName: string | null;
	avatar: string | null;
	ownerId: string;
}

export interface RawMatchup {
	roster_id: number;
	matchup_id: number;
	points: number;
	starters: string[];
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** CDN thumbnail URL from a Sleeper avatar hash or full URL. */
export function avatarUrl(hash: string | null | undefined): string | null {
	if (!hash) return null;
	if (hash.startsWith('http')) return hash;
	return `https://sleepercdn.com/avatars/thumbs/${hash}`;
}

/** Combine Sleeper's split fpts + fpts_decimal fields into a single float. */
export function combineFpts(fpts: number = 0, fptsDecimal: number = 0): number {
	return fpts + fptsDecimal / 100;
}

/**
 * Build a roster_id → display-info map from raw rosters + users.
 * This is the most-repeated join in the codebase: every page that shows
 * team names, avatars, or owners goes through this.
 */
export function buildRosterInfoMap(
	rosters: SleeperRoster[],
	users: SleeperLeagueUser[]
): Map<number, RosterInfo> {
	const userMap = new Map(users.map((u) => [u.user_id, u]));
	const map = new Map<number, RosterInfo>();
	for (const r of rosters) {
		const u = userMap.get(r.owner_id);
		map.set(r.roster_id, {
			teamName: u?.metadata?.team_name ?? u?.display_name ?? `Team ${r.roster_id}`,
			ownerName: u?.display_name ?? null,
			avatar: avatarUrl(u?.metadata?.avatar ?? u?.avatar),
			ownerId: r.owner_id,
		});
	}
	return map;
}

// ── Internal fetch helper ─────────────────────────────────────────────────────

async function sleeperGet<T>(url: string): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Sleeper API ${res.status}: ${url}`);
	if (!res.headers.get('content-type')?.includes('application/json')) {
		throw new Error(`Unexpected content-type from Sleeper API: ${url}`);
	}
	return res.json() as Promise<T>;
}

// ── Individual fetch wrappers ─────────────────────────────────────────────────

export function fetchLeague(leagueId: string): Promise<SleeperLeague> {
	return sleeperGet(`${BASE}/league/${leagueId}`);
}

export function fetchRosters(leagueId: string): Promise<SleeperRoster[]> {
	return sleeperGet(`${BASE}/league/${leagueId}/rosters`);
}

export function fetchUsers(leagueId: string): Promise<SleeperLeagueUser[]> {
	return sleeperGet(`${BASE}/league/${leagueId}/users`);
}

export function fetchNflState(): Promise<SleeperNflState> {
	return sleeperGet(`${BASE}/state/nfl`);
}

export function fetchMatchups(leagueId: string, week: number): Promise<RawMatchup[]> {
	return sleeperGet(`${BASE}/league/${leagueId}/matchups/${week}`);
}

export function fetchWinnersBracket(leagueId: string): Promise<any[]> {
	return sleeperGet(`${BASE}/league/${leagueId}/winners_bracket`);
}

export function fetchLosersBracket(leagueId: string): Promise<any[]> {
	return sleeperGet(`${BASE}/league/${leagueId}/losers_bracket`);
}

export function fetchTransactions(leagueId: string, week: number): Promise<any[]> {
	return sleeperGet(`${BASE}/league/${leagueId}/transactions/${week}`);
}

export function fetchDrafts(leagueId: string): Promise<any[]> {
	return sleeperGet(`${BASE}/league/${leagueId}/drafts`);
}

export function fetchDraftPicks(draftId: string): Promise<any[]> {
	return sleeperGet(`${BASE}/draft/${draftId}/picks`);
}

// ── Combo fetch ───────────────────────────────────────────────────────────────

/** Fetch the three most-common resources in parallel. */
export async function fetchLeagueCore(leagueId: string): Promise<{
	league: SleeperLeague;
	rosters: SleeperRoster[];
	users: SleeperLeagueUser[];
}> {
	const [league, rosters, users] = await Promise.all([
		fetchLeague(leagueId),
		fetchRosters(leagueId),
		fetchUsers(leagueId),
	]);
	return { league, rosters, users };
}
