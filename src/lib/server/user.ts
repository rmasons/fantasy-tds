import { adminDb } from '$lib/firebase/admin';
import type { UserProfile } from '$lib/types';

// Brief per-instance cache to spare a Firestore read on every authenticated
// request. Writes through upsertUserProfile evict the entry so same-instance
// requests are immediately consistent; cross-instance staleness is <= TTL.
const PROFILE_CACHE_TTL_MS = 30_000;
const profileCache = new Map<string, { profile: UserProfile; ts: number }>();

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
	const doc = await adminDb().collection('users').doc(uid).get();
	if (!doc.exists) return null;
	const d = doc.data()!;
	return {
		...d,
		sleeperUserId: d.sleeperUserId ?? null,
		sleeperUsername: d.sleeperUsername ?? null,
		lastLeagueId: d.lastLeagueId ?? null,
	} as UserProfile;
}

export async function getUserProfileCached(uid: string): Promise<UserProfile | null> {
	const hit = profileCache.get(uid);
	if (hit && Date.now() - hit.ts < PROFILE_CACHE_TTL_MS) return hit.profile;

	try {
		const profile = await getUserProfile(uid);
		if (profile) {
			if (profileCache.size > 1000) profileCache.clear();
			profileCache.set(uid, { profile, ts: Date.now() });
		} else {
			profileCache.delete(uid);
		}
		return profile;
	} catch (e) {
		// Firestore unavailable (e.g. read quota exhausted). Serve a stale cached
		// profile if we have one rather than failing the request; otherwise null.
		// hooks.server.ts keeps the (still-valid) session cookie on null, so this
		// degrades the profile without logging the user out. See the catch there.
		console.error('[user] profile read failed for', uid, e);
		return hit?.profile ?? null;
	}
}

/** uid of the user who has linked this Sleeper account, or null if unclaimed. */
export async function getUidBySleeperId(sleeperUserId: string): Promise<string | null> {
	const snap = await adminDb()
		.collection('users')
		.where('sleeperUserId', '==', sleeperUserId)
		.limit(1)
		.get();
	return snap.empty ? null : snap.docs[0].id;
}

export async function upsertUserProfile(uid: string, data: Partial<UserProfile>): Promise<void> {
	await adminDb()
		.collection('users')
		.doc(uid)
		.set(data, { merge: true });
	profileCache.delete(uid); // keep same-instance reads consistent after a write
}
