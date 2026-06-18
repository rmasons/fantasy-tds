import { cachedFetch, cacheKey } from '$lib/server/cache';
import { fetchLeagueCore, buildRosterInfoMap } from '$lib/sleeper';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';
import { getPlayers } from '$lib/server/players';
import type { SlimPlayer } from '$lib/types';

const SCHEMA_VERSION = 1;
const TTL_MS = 15 * 60 * 1000; // rosters move with waivers/trades — refresh every 15 min

export interface RosterPlayer {
	id: string;
	name: string;
	pos: string;
	team: string;
}

export interface RosterTeam {
	rosterId: number;
	teamName: string;
	ownerName: string | null;
	avatar: string | null;
	starters: RosterPlayer[];
	bench: RosterPlayer[];
	ir: RosterPlayer[];
}

function playerInfo(id: string, players: Record<string, SlimPlayer>): RosterPlayer {
	const p = players[id];
	return p ? { id, name: p.name, pos: p.pos, team: p.team } : { id, name: id, pos: '?', team: 'FA' };
}

async function buildRosters(leagueId: string): Promise<RosterTeam[]> {
	const [{ rosters, users }, players] = await Promise.all([fetchLeagueCore(leagueId), getPlayers()]);

	const profiles = await getManagerProfilesBatch(rosters.map((r) => r.owner_id).filter(Boolean));
	const overrides = new Map<string, string>();
	for (const [uid, p] of profiles) if (p.displayName) overrides.set(uid, p.displayName);

	const rosterInfo = buildRosterInfoMap(rosters, users, overrides);

	const teams = rosters.map((r) => {
		const info = rosterInfo.get(r.roster_id)!;
		const starterIds = new Set(r.starters ?? []);
		const irIds = new Set(r.reserve ?? []);
		const allIds: string[] = r.players ?? [];

		return {
			rosterId: r.roster_id,
			teamName: info.teamName,
			ownerName: info.ownerName,
			avatar: info.avatar,
			starters: [...starterIds].map((id) => playerInfo(id, players)),
			bench: allIds.filter((id) => !starterIds.has(id) && !irIds.has(id)).map((id) => playerInfo(id, players)),
			ir: [...irIds].map((id) => playerInfo(id, players)),
		};
	});

	teams.sort((a, b) => a.teamName.localeCompare(b.teamName));
	return teams;
}

export function getRosters(leagueId: string): Promise<RosterTeam[]> {
	return cachedFetch<RosterTeam[]>(cacheKey('rostersCache', leagueId), {
		schemaVersion: SCHEMA_VERSION,
		ttlMs: TTL_MS,
		fetcher: () => buildRosters(leagueId),
	});
}
