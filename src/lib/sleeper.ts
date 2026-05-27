import type { SleeperLeague, SleeperLeagueUser, SleeperNflState, SleeperRoster } from './types';

const BASE = 'https://api.sleeper.app/v1';

const _clientCache = new Map<string, { data: unknown; ts: number }>();
const _CACHE_TTL = 24 * 60 * 60 * 1000;

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
	players?: string[];
	players_points?: Record<string, number>;
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
 *
 * Pass nameOverrides (sleeperUserId → preferred name) to substitute
 * Sleeper usernames with manager-chosen display names.
 */
export function buildRosterInfoMap(
	rosters: SleeperRoster[],
	users: SleeperLeagueUser[],
	nameOverrides?: Map<string, string>
): Map<number, RosterInfo> {
	const userMap = new Map(users.map((u) => [u.user_id, u]));
	const map = new Map<number, RosterInfo>();
	for (const r of rosters) {
		const u = userMap.get(r.owner_id);
		map.set(r.roster_id, {
			teamName: nameOverrides?.get(r.owner_id) ?? u?.metadata?.team_name ?? u?.display_name ?? `Team ${r.roster_id}`,
			ownerName: u?.display_name ?? null,
			avatar: avatarUrl(u?.metadata?.avatar ?? u?.avatar),
			ownerId: r.owner_id,
		});
	}
	return map;
}

/**
 * Fetch preferred display name overrides for a set of Sleeper user IDs.
 * Falls back to an empty map on any error so callers never need to guard.
 */
export async function fetchDisplayNameOverrides(userIds: string[]): Promise<Map<string, string>> {
	if (!userIds.length) return new Map();
	try {
		const res = await fetch(`/api/profile/display-names?userIds=${userIds.join(',')}`);
		if (!res.ok) return new Map();
		const { overrides } = await res.json();
		return new Map(Object.entries(overrides as Record<string, string>));
	} catch {
		return new Map();
	}
}

// ── Internal fetch helper ─────────────────────────────────────────────────────

async function sleeperGet<T>(url: string): Promise<T> {
	if (typeof window !== 'undefined') {
		const hit = _clientCache.get(url);
		if (hit && Date.now() - hit.ts < _CACHE_TTL) return hit.data as T;
	}
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Sleeper API ${res.status}: ${url}`);
	if (!res.headers.get('content-type')?.includes('application/json')) {
		throw new Error(`Unexpected content-type from Sleeper API: ${url}`);
	}
	const data = await res.json() as T;
	if (typeof window !== 'undefined') _clientCache.set(url, { data, ts: Date.now() });
	return data;
}

// ── Individual fetch wrappers ─────────────────────────────────────────────────

export function fetchLeague(leagueId: string): Promise<SleeperLeague> {
	return sleeperGet(`${BASE}/league/${leagueId}`);
}

export function fetchUser(username: string): Promise<import('./types').SleeperUser> {
	return sleeperGet(`${BASE}/user/${username}`);
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
