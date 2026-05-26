import { adminDb } from '$lib/firebase/admin';
import type { SlimPlayer } from '$lib/types';

// Bump when SlimPlayer shape changes to invalidate the Firestore cache.
const SCHEMA_VERSION = 2;

let memCache: Record<string, SlimPlayer> | null = null;
let memCacheDate = '';

function today(): string {
	return new Date().toISOString().split('T')[0];
}

async function fetchAndSlimFromSleeper(): Promise<Record<string, SlimPlayer>> {
	const res = await fetch('https://api.sleeper.app/v1/players/nfl');
	if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) {
		throw new Error(`Sleeper API error: ${res.status}`);
	}
	const raw: Record<string, any> = await res.json();

	return Object.fromEntries(
		Object.entries(raw)
			.filter(([, p]) => p.active || p.status === 'Active')
			.map(([id, p]) => [
				id,
				{
					name: p.full_name ?? (`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || id),
					pos: p.position ?? '?',
					team: p.team ?? 'FA',
					yearsExp: p.years_exp ?? 0,
					...(p.number != null ? { number: p.number } : {}),
				} satisfies SlimPlayer,
			])
	);
}

export async function getPlayers(): Promise<Record<string, SlimPlayer>> {
	const date = today();

	if (memCache && memCacheDate === date) return memCache;

	const docRef = adminDb.collection('playersCache').doc('players_nfl');

	try {
		const doc = await docRef.get();
		if (doc.exists) {
			const cached = doc.data()!;
			if (cached.cachedDate === date && cached.schemaVersion === SCHEMA_VERSION) {
				memCache = JSON.parse(cached.data);
				memCacheDate = date;
				return memCache!;
			}
		}
	} catch (e) {
		console.warn('[players] Firestore read failed, falling back to Sleeper:', e);
	}

	const slim = await fetchAndSlimFromSleeper();
	const jsonStr = JSON.stringify(slim);
	console.log(`[players] Cache payload size: ${(jsonStr.length / 1024).toFixed(1)} KB`);
	try {
		await docRef.set({ data: jsonStr, cachedDate: date, schemaVersion: SCHEMA_VERSION });
	} catch (e) {
		console.error('[players] Failed to write to Firestore:', e);
	}

	memCache = slim;
	memCacheDate = date;
	return slim;
}
