import { put, list } from '@vercel/blob';
import { env } from '$env/dynamic/private';
import type { SlimPlayer } from '$lib/types';

// Bump when SlimPlayer shape changes to invalidate the blob cache.
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

// The slim active-player set is a daily snapshot of regenerable Sleeper data, so
// it lives in Vercel Blob as a single object — one fetch per cold start instead
// of the manifest + N chunk-doc reads the old Firestore scheme required. The
// pathname is date- and schema-stamped, so each day's blob is written once and
// is effectively immutable; that sidesteps any CDN staleness on overwrite.
const blobPath = (date: string) => `players/nfl-${date}-v${SCHEMA_VERSION}.json`;
const blobToken = () => env.BLOB_READ_WRITE_TOKEN;

async function readFromBlob(date: string): Promise<Record<string, SlimPlayer> | null> {
	const { blobs } = await list({ prefix: blobPath(date), limit: 1, token: blobToken() });
	if (blobs.length === 0) return null;
	const res = await fetch(blobs[0].url);
	if (!res.ok) return null;
	return (await res.json()) as Record<string, SlimPlayer>;
}

async function writeToBlob(slim: Record<string, SlimPlayer>, date: string): Promise<void> {
	await put(blobPath(date), JSON.stringify(slim), {
		access: 'public',
		addRandomSuffix: false,
		allowOverwrite: true,
		contentType: 'application/json',
		token: blobToken(),
	});
}

export async function getPlayers(): Promise<Record<string, SlimPlayer>> {
	const date = today();

	if (memCache && memCacheDate === date) return memCache;

	try {
		const cached = await readFromBlob(date);
		if (cached) {
			memCache = cached;
			memCacheDate = date;
			return cached;
		}
	} catch (e) {
		console.warn('[players] Blob read failed, falling back to Sleeper:', e);
	}

	const slim = await fetchAndSlimFromSleeper();
	try {
		await writeToBlob(slim, date);
	} catch (e) {
		console.error('[players] Failed to write to Blob:', e);
	}

	memCache = slim;
	memCacheDate = date;
	return slim;
}
