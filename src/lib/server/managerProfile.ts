import { adminDb } from '$lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import type { ManagerProfile, ManagerLeagueProfile } from '$lib/types';

export const PROFILE_MAX_LENGTHS: Record<string, number> = {
	displayName: 50,
	firstName: 50,
	lastName: 50,
	bio: 280,
	location: 60,
	favoriteNFLTeam: 60,
	favoritePlayer: 60,
	funFact: 200,
	twitterHandle: 50,
};

export async function getManagerProfile(sleeperUserId: string): Promise<ManagerProfile | null> {
	const doc = await adminDb.collection('managerProfiles').doc(sleeperUserId).get();
	if (!doc.exists) return null;
	return doc.data() as ManagerProfile;
}

export async function upsertManagerProfile(
	sleeperUserId: string,
	data: Partial<Omit<ManagerProfile, 'sleeperUserId' | 'updatedAt'>>
): Promise<void> {
	const toWrite: Record<string, any> = { sleeperUserId, updatedAt: Date.now() };
	for (const [k, v] of Object.entries(data)) {
		toWrite[k] = v === undefined ? FieldValue.delete() : v;
	}
	await adminDb.collection('managerProfiles').doc(sleeperUserId).set(toWrite, { merge: true });
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
	const toWrite: Record<string, any> = { leagueId, updatedAt: Date.now() };
	for (const [k, v] of Object.entries(data)) {
		toWrite[k] = v === undefined ? FieldValue.delete() : v;
	}
	await adminDb.collection('managerProfiles').doc(sleeperUserId).collection('leagues').doc(leagueId).set(toWrite, { merge: true });
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
