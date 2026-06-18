import { adminDb } from '$lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { ManagerProfile, ManagerLeagueProfile } from '$lib/types';

// Manager profiles are read on nearly every request (display-name overrides on
// standings, records, home, etc.) but change rarely. Without a cache each render
// costs one Firestore read per manager — the dominant source of read-quota burn.
// Cache per sleeperUserId with a short TTL; null is cached too (negative caching)
// so absent profiles aren't re-read every request. Writes evict the entry so the
// editing instance is immediately consistent; cross-instance staleness is <= TTL.
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const profileCache = new Map<string, { profile: ManagerProfile | null; ts: number }>();

function getCachedProfile(id: string): ManagerProfile | null | undefined {
	const hit = profileCache.get(id);
	if (hit && Date.now() - hit.ts < PROFILE_CACHE_TTL_MS) return hit.profile;
	if (hit) profileCache.delete(id);
	return undefined; // cache miss (distinct from a cached null)
}

function setCachedProfile(id: string, profile: ManagerProfile | null): void {
	if (profileCache.size > 1000) profileCache.clear();
	profileCache.set(id, { profile, ts: Date.now() });
}

export const PROFILE_MAX_LENGTHS: Record<string, number> = {
	displayName: 50,
	firstName: 50,
	lastName: 50,
	bio: 280,
	location: 60,
	favoriteNFLTeam: 60,
	favoritePlayer: 60,
	favoritePlayerId: 10,
	preferredContact: 60,
};

// Fields kept off public responses; only returned to authenticated league-mates.
const PRIVATE_PROFILE_FIELDS = ['email', 'firstName', 'lastName', 'preferredContact'] as const;

/** Strip personally-identifying fields, leaving the public subset. */
export function redactManagerProfile(profile: ManagerProfile): ManagerProfile {
	const out = { ...profile };
	for (const f of PRIVATE_PROFILE_FIELDS) delete out[f];
	return out;
}

export async function getManagerProfile(sleeperUserId: string): Promise<ManagerProfile | null> {
	const cached = getCachedProfile(sleeperUserId);
	if (cached !== undefined) return cached;

	const doc = await adminDb().collection('managerProfiles').doc(sleeperUserId).get();
	const profile = doc.exists ? (doc.data() as ManagerProfile) : null;
	setCachedProfile(sleeperUserId, profile);
	return profile;
}

export async function upsertManagerProfile(
	sleeperUserId: string,
	data: Partial<Omit<ManagerProfile, 'sleeperUserId' | 'updatedAt'>>
): Promise<void> {
	const toWrite: Record<string, any> = { sleeperUserId, updatedAt: Date.now() };
	for (const [k, v] of Object.entries(data)) {
		toWrite[k] = v === undefined ? FieldValue.delete() : v;
	}
	await adminDb().collection('managerProfiles').doc(sleeperUserId).set(toWrite, { merge: true });
	profileCache.delete(sleeperUserId); // keep same-instance reads consistent after a write
}

export async function getManagerLeagueProfile(
	sleeperUserId: string,
	leagueId: string
): Promise<ManagerLeagueProfile | null> {
	const doc = await adminDb()
		.collection('managerProfiles')
		.doc(sleeperUserId)
		.collection('leagues')
		.doc(leagueId)
		.get();
	if (!doc.exists) return null;
	return doc.data() as ManagerLeagueProfile;
}

export async function upsertManagerLeagueProfile(
	sleeperUserId: string,
	leagueId: string,
	data: Partial<Omit<ManagerLeagueProfile, 'leagueId' | 'updatedAt'>>
): Promise<void> {
	const toWrite: Record<string, any> = { leagueId, updatedAt: Date.now() };
	for (const [k, v] of Object.entries(data)) {
		toWrite[k] = v === undefined ? FieldValue.delete() : v;
	}
	await adminDb().collection('managerProfiles').doc(sleeperUserId).collection('leagues').doc(leagueId).set(toWrite, { merge: true });
}

export async function getManagerProfilesBatch(
	sleeperUserIds: string[]
): Promise<Map<string, ManagerProfile>> {
	const map = new Map<string, ManagerProfile>();
	const uniqueIds = [...new Set(sleeperUserIds)];

	// Serve what we can from cache; only hit Firestore for the misses.
	const misses: string[] = [];
	for (const id of uniqueIds) {
		const cached = getCachedProfile(id);
		if (cached === undefined) misses.push(id);
		else if (cached) map.set(id, cached);
	}

	if (misses.length > 0) {
		const refs = misses.map(id => adminDb().collection('managerProfiles').doc(id));
		const docs = await adminDb().getAll(...refs);
		for (const doc of docs) {
			const profile = doc.exists ? (doc.data() as ManagerProfile) : null;
			setCachedProfile(doc.id, profile); // cache null too, to avoid re-reading absent profiles
			if (profile) map.set(doc.id, profile);
		}
	}

	return map;
}
