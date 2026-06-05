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

export async function upsertUserProfile(uid: string, data: Partial<UserProfile>): Promise<void> {
	await adminDb()
		.collection('users')
		.doc(uid)
		.set(data, { merge: true });
}
