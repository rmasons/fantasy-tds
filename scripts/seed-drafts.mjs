/**
 * Prepopulate Firestore draft caches for all configured leagues.
 *
 * Usage:
 *   node scripts/seed-drafts.mjs                    # seeds all leagues in leagueConfig
 *   node scripts/seed-drafts.mjs <id1> [id2] ...    # seeds specific league IDs
 *
 * Walks each league's previous_league_id chain so every season in the
 * history is covered. Already-cached draft picks are skipped (idempotent).
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
	const lines = readFileSync(join(ROOT, '.env'), 'utf-8').split('\n');
	const out = {};
	for (const line of lines) {
		const t = line.trim();
		if (!t || t.startsWith('#')) continue;
		const eq = t.indexOf('=');
		if (eq < 0) continue;
		out[t.slice(0, eq)] = t.slice(eq + 1);
	}
	return out;
}

const env = loadEnv();
if (!env.FIREBASE_SERVICE_ACCOUNT) {
	console.error('FIREBASE_SERVICE_ACCOUNT not found in .env');
	process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();

// ── Sleeper helpers ───────────────────────────────────────────────────────────

const BASE = 'https://api.sleeper.app/v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sleeperGet(path, retries = 2) {
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(10_000) });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			return res.json();
		} catch (e) {
			if (attempt === retries) throw e;
			await sleep(500 * (attempt + 1));
		}
	}
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

async function getConfiguredLeagueIds() {
	const snap = await db.collection('leagueConfig').get();
	return snap.docs.map(d => d.id);
}

async function picksCached(draftId) {
	const doc = await db.collection('draftPicksCache').doc(draftId).get();
	return doc.exists ? (doc.data().picks?.length ?? 0) : null;
}

async function cacheDraftList(leagueId, drafts) {
	await db.collection('draftListCache').doc(leagueId).set({
		drafts,
		cachedAt: new Date().toISOString(),
	});
}

async function cachePicks(draftId, picks) {
	await db.collection('draftPicksCache').doc(draftId).set({
		picks,
		cachedAt: new Date().toISOString(),
	});
}

// ── Core seeding logic ────────────────────────────────────────────────────────

async function seedLeague(startLeagueId) {
	let currentId = startLeagueId;
	const summary = [];

	while (currentId && currentId !== '0') {
		// Fetch league metadata
		let league;
		try {
			process.stdout.write(`  ${currentId}  fetching league... `);
			league = await sleeperGet(`/league/${currentId}`);
			process.stdout.write(`season ${league.season}\n`);
		} catch (e) {
			console.error(`FAILED: ${e.message}`);
			break;
		}
		await sleep(100);

		// Cache the draft list for this season
		let drafts = [];
		try {
			process.stdout.write(`  ${currentId}  fetching draft list... `);
			drafts = await sleeperGet(`/league/${currentId}/drafts`) ?? [];
			await cacheDraftList(currentId, drafts);
			console.log(`${drafts.length} draft(s) stored`);
		} catch (e) {
			console.error(`FAILED: ${e.message}`);
		}
		await sleep(100);

		// Cache picks for each completed draft
		const completed = drafts.filter(d => d.status === 'complete');
		for (const draft of completed) {
			const draftId = draft.draft_id;
			const alreadyCached = await picksCached(draftId);

			if (alreadyCached !== null) {
				console.log(`  ${draftId}  ${draft.type} (${league.season}) — already cached (${alreadyCached} picks)`);
				summary.push({ draftId, season: league.season, picks: alreadyCached, skipped: true });
				continue;
			}

			process.stdout.write(`  ${draftId}  ${draft.type} (${league.season}) — fetching picks... `);
			try {
				const picks = await sleeperGet(`/draft/${draftId}/picks`);
				await cachePicks(draftId, picks);
				console.log(`${picks.length} picks stored`);
				summary.push({ draftId, season: league.season, picks: picks.length, skipped: false });
			} catch (e) {
				console.error(`FAILED: ${e.message}`);
				summary.push({ draftId, season: league.season, picks: 0, error: e.message });
			}
			await sleep(150);
		}

		currentId = league.previous_league_id ?? null;
	}

	return summary;
}

// ── Main ──────────────────────────────────────────────────────────────────────

const argIds = process.argv.slice(2);
const leagueIds = argIds.length ? argIds : await getConfiguredLeagueIds();

if (!leagueIds.length) {
	console.error(
		'No league IDs found.\n' +
		'Either pass them as arguments or register leagues in Firestore first.\n' +
		'Usage: node scripts/seed-drafts.mjs <leagueId1> [leagueId2] ...'
	);
	process.exit(1);
}

console.log(`Seeding ${leagueIds.length} league(s): ${leagueIds.join(', ')}\n`);

let totalNew = 0, totalSkipped = 0, totalPicks = 0, totalErrors = 0;

for (const leagueId of leagueIds) {
	console.log(`\n── ${leagueId} ──`);
	const results = await seedLeague(leagueId);
	for (const r of results) {
		if (r.error)        totalErrors++;
		else if (r.skipped) totalSkipped++;
		else               { totalNew++; totalPicks += r.picks; }
	}
}

console.log(
	`\nDone — ${totalNew} draft(s) newly cached` +
	` (${totalPicks} picks), ${totalSkipped} skipped, ${totalErrors} error(s)`
);
process.exit(totalErrors > 0 ? 1 : 0);
