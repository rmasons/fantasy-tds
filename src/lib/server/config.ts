import { adminDb } from '$lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { cachedFetch, deleteCache, cacheKey } from '$lib/server/cache';

// leagueConfig is read on every league page but changes only via admin action.
// Cache it (off the Firestore hot path) and evict on write. Short TTL bounds
// cross-write staleness even if an eviction is missed.
const LEAGUE_CONFIG_TTL_MS = 5 * 60 * 1000;
const leagueConfigKey = (leagueId: string) => cacheKey('leagueConfigCache', leagueId);

// config/app is read on the anonymous landing page (the redirect to the default
// league), so an uncached/unhardened read 500s the site entry when Firestore is
// down. Same cache+fail-soft treatment as leagueConfig.
const APP_CONFIG_TTL_MS = 5 * 60 * 1000;
const appConfigKey = () => cacheKey('appConfigCache', 'app');

export interface AppConfig {
	defaultLeagueId?: string;
}

/** A single commissioner FAAB adjustment, shown to the league as a transaction. */
export interface FaabTransaction {
	id: string;
	/** roster_id (as string) the adjustment applies to */
	rosterId: string;
	/** signed amount: positive = grant, negative = penalty */
	amount: number;
	/** why the adjustment was made (shown in the ledger) */
	reason: string;
	/** epoch ms */
	createdAt: number;
	/** display name of the admin who entered it */
	createdBy: string;
}

export interface LeagueConfig {
	contentfulSpaceId?: string;
	contentfulAccessToken?: string;
	contentfulManagementToken?: string;
	/** Ordered list of nav slugs to show; omit to show all defaults */
	enabledNavItems?: string[];
	/**
	 * Per-roster net FAAB adjustment (sum of faabTransactions), keyed by
	 * roster_id (as string). Kept in sync on every ledger write so consumers
	 * (keepers budget math) read the net without summing the ledger.
	 */
	faabBonuses?: Record<string, number>;
	/** Full ledger of commissioner FAAB adjustments (source of truth). */
	faabTransactions?: FaabTransaction[];
}

function toFirestoreWrite(obj: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		out[k] = v === undefined ? FieldValue.delete() : v;
	}
	return out;
}

export async function getAppConfig(): Promise<AppConfig> {
	try {
		return await cachedFetch<AppConfig>(appConfigKey(), {
			ttlMs: APP_CONFIG_TTL_MS,
			fetcher: async () => {
				const doc = await adminDb().collection('config').doc('app').get();
				return doc.exists ? (doc.data() as AppConfig) : {};
			},
		});
	} catch (e) {
		// Firestore unavailable and no warm cache: degrade to empty config so the
		// landing page still renders (falls through to /login) instead of 500-ing.
		console.error('[config] appConfig unavailable', e);
		return {};
	}
}

export async function setAppConfig(config: Partial<AppConfig>): Promise<void> {
	await adminDb().collection('config').doc('app').set(toFirestoreWrite(config as Record<string, unknown>), { merge: true });
	await deleteCache(appConfigKey());
}

export async function getLeagueConfig(leagueId: string): Promise<LeagueConfig> {
	try {
		return await cachedFetch<LeagueConfig>(leagueConfigKey(leagueId), {
			ttlMs: LEAGUE_CONFIG_TTL_MS,
			fetcher: async () => {
				const doc = await adminDb().collection('leagueConfig').doc(leagueId).get();
				return doc.exists ? (doc.data() as LeagueConfig) : {};
			},
		});
	} catch (e) {
		// Firestore unavailable (e.g. read quota exhausted) and no warm cache:
		// degrade to empty config so the league layout renders instead of 500-ing.
		// The failure is NOT cached — recovery is picked up on the next request.
		console.error('[config] leagueConfig unavailable for', leagueId, e);
		return {};
	}
}

export async function setLeagueConfig(leagueId: string, config: Partial<LeagueConfig>): Promise<void> {
	await adminDb().collection('leagueConfig').doc(leagueId).set(toFirestoreWrite(config as Record<string, unknown>), { merge: true });
	await deleteCache(leagueConfigKey(leagueId));
}

export async function getAllLeagueConfigs(): Promise<Record<string, LeagueConfig>> {
	const snap = await adminDb().collection('leagueConfig').get();
	const result: Record<string, LeagueConfig> = {};
	snap.forEach(doc => { result[doc.id] = doc.data() as LeagueConfig; });
	return result;
}

export async function deleteLeagueConfig(leagueId: string): Promise<void> {
	await adminDb().collection('leagueConfig').doc(leagueId).delete();
	await deleteCache(leagueConfigKey(leagueId));
}
