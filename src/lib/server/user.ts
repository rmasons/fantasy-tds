import { adminDb } from '$lib/firebase/admin';
import type { UserProfile } from '$lib/types';

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
	const doc = await adminDb.collection('users').doc(uid).get();
	if (!doc.exists) return null;
	return doc.data() as UserProfile;
}

export async function upsertUserProfile(uid: string, data: Partial<UserProfile>): Promise<void> {
	await adminDb
		.collection('users')
		.doc(uid)
		.set(data, { merge: true });
}
