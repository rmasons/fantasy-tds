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

// The slimmed active-player set is too large for a single Firestore doc (1 MB
// ceiling), so it is sharded across N chunk docs plus a manifest doc.
const CHUNK_SIZE = 1000; // entries per chunk doc — well under the 1 MB limit
const MANIFEST_ID = 'players_nfl';
const chunkId = (i: number) => `${MANIFEST_ID}_${i}`;

async function readChunks(chunkCount: number): Promise<Record<string, SlimPlayer>> {
	const col = adminDb().collection('playersCache');
	const refs = Array.from({ length: chunkCount }, (_, i) => col.doc(chunkId(i)));
	const docs = await adminDb().getAll(...refs);
	const merged: Record<string, SlimPlayer> = {};
	for (const d of docs) {
		if (!d.exists) throw new Error(`players cache missing chunk ${d.id}`);
		Object.assign(merged, JSON.parse(d.data()!.data));
	}
	return merged;
}

async function writeChunks(slim: Record<string, SlimPlayer>, date: string): Promise<void> {
	const col = adminDb().collection('playersCache');
	const entries = Object.entries(slim);
	const chunkCount = Math.max(1, Math.ceil(entries.length / CHUNK_SIZE));
	const batch = adminDb().batch();
	for (let i = 0; i < chunkCount; i++) {
		const slice = Object.fromEntries(entries.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
		batch.set(col.doc(chunkId(i)), { data: JSON.stringify(slice) });
	}
	batch.set(col.doc(MANIFEST_ID), { chunkCount, cachedDate: date, schemaVersion: SCHEMA_VERSION });
	await batch.commit();
}

export async function getPlayers(): Promise<Record<string, SlimPlayer>> {
	const date = today();

	if (memCache && memCacheDate === date) return memCache;

	try {
		const manifest = await adminDb().collection('playersCache').doc(MANIFEST_ID).get();
		if (manifest.exists) {
			const m = manifest.data()!;
			if (m.cachedDate === date && m.schemaVersion === SCHEMA_VERSION && typeof m.chunkCount === 'number') {
				memCache = await readChunks(m.chunkCount);
				memCacheDate = date;
				return memCache;
			}
		}
	} catch (e) {
		console.warn('[players] Firestore read failed, falling back to Sleeper:', e);
	}

	const slim = await fetchAndSlimFromSleeper();
	try {
		await writeChunks(slim, date);
	} catch (e) {
		console.error('[players] Failed to write to Firestore:', e);
	}

	memCache = slim;
	memCacheDate = date;
	return slim;
}
