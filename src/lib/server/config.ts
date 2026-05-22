import { adminDb } from '$lib/firebase/admin';

export interface AppConfig {
	defaultLeagueId?: string;
}

export interface LeagueConfig {
	contentfulSpaceId?: string;
	contentfulAccessToken?: string;
	contentfulManagementToken?: string;
}

export async function getAppConfig(): Promise<AppConfig> {
	const doc = await adminDb.collection('config').doc('app').get();
	if (!doc.exists) return {};
	return doc.data() as AppConfig;
}

export async function setAppConfig(config: Partial<AppConfig>): Promise<void> {
	await adminDb.collection('config').doc('app').set(config, { merge: true });
}

export async function getLeagueConfig(leagueId: string): Promise<LeagueConfig> {
	const doc = await adminDb.collection('leagueConfig').doc(leagueId).get();
	if (!doc.exists) return {};
	return doc.data() as LeagueConfig;
}

export async function setLeagueConfig(leagueId: string, config: Partial<LeagueConfig>): Promise<void> {
	await adminDb.collection('leagueConfig').doc(leagueId).set(config, { merge: true });
}
