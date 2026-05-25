import { adminDb } from '$lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

export interface AppConfig {
	defaultLeagueId?: string;
}

export interface LeagueConfig {
	contentfulSpaceId?: string;
	contentfulAccessToken?: string;
	contentfulManagementToken?: string;
	/** Ordered list of nav slugs to show; omit to show all defaults */
	enabledNavItems?: string[];
	/** Bonus FAAB awarded outside Sleeper, keyed by roster_id (as string) */
	faabBonuses?: Record<string, number>;
}

function toFirestoreWrite(obj: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		out[k] = v === undefined ? FieldValue.delete() : v;
	}
	return out;
}

export async function getAppConfig(): Promise<AppConfig> {
	const doc = await adminDb.collection('config').doc('app').get();
	if (!doc.exists) return {};
	return doc.data() as AppConfig;
}

export async function setAppConfig(config: Partial<AppConfig>): Promise<void> {
	await adminDb.collection('config').doc('app').set(toFirestoreWrite(config as Record<string, unknown>), { merge: true });
}

export async function getLeagueConfig(leagueId: string): Promise<LeagueConfig> {
	const doc = await adminDb.collection('leagueConfig').doc(leagueId).get();
	if (!doc.exists) return {};
	return doc.data() as LeagueConfig;
}

export async function setLeagueConfig(leagueId: string, config: Partial<LeagueConfig>): Promise<void> {
	await adminDb.collection('leagueConfig').doc(leagueId).set(toFirestoreWrite(config as Record<string, unknown>), { merge: true });
}

export async function getAllLeagueConfigs(): Promise<Record<string, LeagueConfig>> {
	const snap = await adminDb.collection('leagueConfig').get();
	const result: Record<string, LeagueConfig> = {};
	snap.forEach(doc => { result[doc.id] = doc.data() as LeagueConfig; });
	return result;
}

export async function deleteLeagueConfig(leagueId: string): Promise<void> {
	await adminDb.collection('leagueConfig').doc(leagueId).delete();
}
