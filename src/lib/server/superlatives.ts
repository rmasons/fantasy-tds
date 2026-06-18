import { adminDb } from '$lib/firebase/admin';
import { cachedFetch, cacheKey } from '$lib/server/cache';
import { fetchLeague, fetchUser, avatarUrl } from '$lib/sleeper';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';

const SCHEMA_VERSION = 1;
const TTL_MS = 6 * 60 * 60 * 1000; // history changes rarely (admin posts a season)

interface StoredAwardEntry {
	ownerId?: string; // Sleeper username
	teamName?: string;
	stat: string;
	sub?: string;
}

export interface SuperlativeSeasonEntry {
	season: string;
	teamName: string;
	avatar: string | null;
	stat: string;
	sub?: string;
}

async function readHistory(leagueId: string): Promise<{ season: string; awards: Record<string, StoredAwardEntry> }[]> {
	let doc = await adminDb().collection('superlativeHistory').doc(leagueId).get();
	if (!doc.exists) {
		// Fall back one hop for new-season transitions.
		try {
			const league = await fetchLeague(leagueId);
			if (league.previous_league_id) {
				doc = await adminDb().collection('superlativeHistory').doc(league.previous_league_id).get();
			}
		} catch {
			// ignore — return empty
		}
	}
	if (!doc.exists) return [];

	const raw = (doc.data()?.seasons ?? {}) as Record<string, Record<string, StoredAwardEntry>>;
	return Object.entries(raw)
		.map(([season, awards]) => ({ season, awards }))
		.sort((a, b) => b.season.localeCompare(a.season));
}

async function buildSuperlatives(leagueId: string): Promise<Record<string, SuperlativeSeasonEntry[]>> {
	const history = await readHistory(leagueId);

	const uniqueOwnerIds = [
		...new Set(history.flatMap((h) => Object.values(h.awards).map((a) => a.ownerId).filter(Boolean))),
	] as string[];

	// ownerId (Sleeper username) -> resolved team name + avatar
	const ownerDisplayMap = new Map<string, { teamName: string; avatar: string | null }>();
	if (uniqueOwnerIds.length > 0) {
		const users = await Promise.all(uniqueOwnerIds.map((u) => fetchUser(u).catch(() => null)));
		const idMap = new Map<string, { userId: string; displayName: string; avatar: string | null }>();
		const resolvedIds: string[] = [];
		for (let i = 0; i < uniqueOwnerIds.length; i++) {
			const p = users[i];
			if (p) {
				idMap.set(uniqueOwnerIds[i], { userId: p.user_id, displayName: p.display_name, avatar: avatarUrl(p.avatar) });
				resolvedIds.push(p.user_id);
			}
		}
		const profiles = await getManagerProfilesBatch(resolvedIds);
		for (const [username, { userId, displayName, avatar }] of idMap) {
			ownerDisplayMap.set(username, { teamName: profiles.get(userId)?.displayName ?? displayName, avatar });
		}
	}

	const entriesByKey: Record<string, SuperlativeSeasonEntry[]> = {};
	for (const { season, awards } of history) {
		for (const [key, entry] of Object.entries(awards)) {
			const resolved = entry.ownerId ? ownerDisplayMap.get(entry.ownerId) : null;
			(entriesByKey[key] ??= []).push({
				season,
				teamName: resolved?.teamName ?? entry.teamName ?? entry.ownerId ?? '',
				avatar: resolved?.avatar ?? null,
				stat: entry.stat,
				sub: entry.sub,
			});
		}
	}
	for (const k of Object.keys(entriesByKey)) entriesByKey[k].sort((a, b) => b.season.localeCompare(a.season));
	return entriesByKey;
}

export function getSuperlatives(leagueId: string): Promise<Record<string, SuperlativeSeasonEntry[]>> {
	return cachedFetch<Record<string, SuperlativeSeasonEntry[]>>(
		cacheKey('superlativesResolvedCache', leagueId),
		{
			schemaVersion: SCHEMA_VERSION,
			ttlMs: TTL_MS,
			fetcher: () => buildSuperlatives(leagueId),
		}
	);
}
