import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminBucket } from '$lib/firebase/admin';
import type { SlimPlayer } from '$lib/types';

// v2 — added yearsExp field; bumping path forces a fresh fetch from Sleeper
const STORAGE_PATH = 'cache/players_nfl_v2.json';

// Process-level memory cache — instant for all requests after the first each day
let memCache: Record<string, SlimPlayer> | null = null;
let memCacheDate = '';

function today(): string {
	return new Date().toISOString().split('T')[0]; // YYYY-MM-DD UTC
}

async function fetchAndSlimFromSleeper(): Promise<Record<string, SlimPlayer>> {
	const res = await fetch('https://api.sleeper.app/v1/players/nfl');
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

	const bucket = adminBucket();
	const file = bucket.file(STORAGE_PATH);

	// 2. Firebase Storage (cold start — server restarted but it's still today)
	try {
		const [metadata] = await file.getMetadata();
		if (metadata.metadata?.date === date) {
			const [content] = await file.download();
			memCache = JSON.parse(content.toString());
			memCacheDate = date;
			return memCache!;
		}
	} catch {
		// File doesn't exist yet or metadata missing — fall through to Sleeper
	}

	// 3. Sleeper API (first open of a new day)
	const slim = await fetchAndSlimFromSleeper();

	// Upload to Firebase Storage with today's date in custom metadata
	try {
		await file.save(JSON.stringify(slim), {
			contentType: 'application/json',
			metadata: { date }
		});
	} catch (e) {
		// Non-fatal — still serve the data even if the upload fails
		console.error('[players] Failed to write to Firebase Storage:', e);
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
