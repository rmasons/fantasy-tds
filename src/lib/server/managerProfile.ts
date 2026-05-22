import { adminDb } from '$lib/firebase/admin';
import type { ManagerProfile, ManagerLeagueProfile } from '$lib/types';

export async function getManagerProfile(sleeperUserId: string): Promise<ManagerProfile | null> {
	const doc = await adminDb.collection('managerProfiles').doc(sleeperUserId).get();
	if (!doc.exists) return null;
	return doc.data() as ManagerProfile;
}

export async function upsertManagerProfile(
	sleeperUserId: string,
	data: Partial<Omit<ManagerProfile, 'sleeperUserId' | 'updatedAt'>>
): Promise<void> {
	await adminDb
		.collection('managerProfiles')
		.doc(sleeperUserId)
		.set({ ...data, sleeperUserId, updatedAt: Date.now() }, { merge: true });
}

export async function getManagerLeagueProfile(
	sleeperUserId: string,
	leagueId: string
): Promise<ManagerLeagueProfile | null> {
	const doc = await adminDb
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
	await adminDb
		.collection('managerProfiles')
		.doc(sleeperUserId)
		.collection('leagues')
		.doc(leagueId)
		.set({ ...data, leagueId, updatedAt: Date.now() }, { merge: true });
}

export async function getManagerProfilesBatch(
	sleeperUserIds: string[]
): Promise<Map<string, ManagerProfile>> {
	if (sleeperUserIds.length === 0) return new Map();
	const refs = sleeperUserIds.map(id => adminDb.collection('managerProfiles').doc(id));
	const docs = await adminDb.getAll(...refs);
	const map = new Map<string, ManagerProfile>();
	for (const doc of docs) {
		if (doc.exists) map.set(doc.id, doc.data() as ManagerProfile);
	}
	return map;
}
