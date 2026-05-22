import type { SleeperLeague, SleeperLeagueUser, SleeperNflState, SleeperRoster } from './types';

const BASE = 'https://api.sleeper.app/v1';

// ── Shared types ──────────────────────────────────────────────────────────────

export interface RosterInfo {
	teamName: string;
	ownerName: string;
	avatar: string | null;
	userId: string;
}

export interface RawMatchup {
	roster_id: number;
	matchup_id: number;
	points: number;
	starters: string[];
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/** CDN thumbnail URL from a Sleeper avatar hash. */
export function avatarUrl(hash: string | null | undefined): string | null {
	return hash ? `https://sleepercdn.com/avatars/thumbs/${hash}` : null;
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
			ownerName: u?.display_name ?? '',
			avatar: avatarUrl(u?.metadata?.avatar ?? u?.avatar),
			userId: r.owner_id,
		});
	}
	return map;
}

// ── Individual fetch wrappers ─────────────────────────────────────────────────

export async function fetchLeague(leagueId: string): Promise<SleeperLeague> {
	return fetch(`${BASE}/league/${leagueId}`).then((r) => r.json());
}

export async function fetchRosters(leagueId: string): Promise<SleeperRoster[]> {
	return fetch(`${BASE}/league/${leagueId}/rosters`).then((r) => r.json());
}

export async function fetchUsers(leagueId: string): Promise<SleeperLeagueUser[]> {
	return fetch(`${BASE}/league/${leagueId}/users`).then((r) => r.json());
}

export async function fetchNflState(): Promise<SleeperNflState> {
	return fetch(`${BASE}/state/nfl`).then((r) => r.json());
}

export async function fetchMatchups(leagueId: string, week: number): Promise<RawMatchup[]> {
	return fetch(`${BASE}/league/${leagueId}/matchups/${week}`).then((r) => r.json());
}

export async function fetchWinnersBracket(leagueId: string): Promise<any[]> {
	return fetch(`${BASE}/league/${leagueId}/winners_bracket`).then((r) => r.json());
}

export async function fetchLosersBracket(leagueId: string): Promise<any[]> {
	return fetch(`${BASE}/league/${leagueId}/losers_bracket`).then((r) => r.json());
}

export async function fetchTransactions(leagueId: string, week: number): Promise<any[]> {
	return fetch(`${BASE}/league/${leagueId}/transactions/${week}`).then((r) => r.json());
}

export async function fetchDrafts(leagueId: string): Promise<any[]> {
	return fetch(`${BASE}/league/${leagueId}/drafts`).then((r) => r.json());
}

export async function fetchDraftPicks(draftId: string): Promise<any[]> {
	return fetch(`${BASE}/draft/${draftId}/picks`).then((r) => r.json());
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
