import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminDb } from '$lib/firebase/admin';
import type { SlimPlayer } from '$lib/types';

// Process-level memory cache — instant for all requests after the first each day
let memCache: Record<string, SlimPlayer> | null = null;
let memCacheDate = '';

function today(): string {
	return new Date().toISOString().split('T')[0]; // YYYY-MM-DD UTC
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
					yearsExp: p.years_exp ?? 0
				} satisfies SlimPlayer
			])
	);
}

async function getPlayers(): Promise<Record<string, SlimPlayer>> {
	const date = today();

	// 1. Memory cache (warm — same process, same day)
	if (memCache && memCacheDate === date) return memCache;

	const docRef = adminDb.collection('cache').doc('players_nfl');

	// 2. Firestore (cold start — server restarted but it's still today)
	try {
		const doc = await docRef.get();
		if (doc.exists) {
			const cached = doc.data()!;
			if (cached.cachedDate === date) {
				memCache = JSON.parse(cached.data);
				memCacheDate = date;
				return memCache!;
			}
		}
	} catch (e) {
		console.warn('[players] Firestore read failed, falling back to Sleeper:', e);
	}

	// 3. Sleeper API (first open of a new day)
	const slim = await fetchAndSlimFromSleeper();

	// Store as a JSON string to avoid per-field overhead for thousands of player keys
	const json_str = JSON.stringify(slim);
	console.log(`[players] Cache payload size: ${(json_str.length / 1024).toFixed(1)} KB`);
	try {
		await docRef.set({ data: json_str, cachedDate: date });
	} catch (e) {
		// Non-fatal — still serve the data even if the cache write fails
		console.error('[players] Failed to write to Firestore:', e);
	}

	memCache = slim;
	memCacheDate = date;
	return slim;
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const players = await getPlayers();
	return json(players);
};
