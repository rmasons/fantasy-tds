import { adminDb } from '$lib/firebase/admin';
import type { UserProfile } from '$lib/types';

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
}
