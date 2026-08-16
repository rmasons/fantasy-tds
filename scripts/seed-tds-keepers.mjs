/**
 * Seed keeper overrides for the TDS league from a pre-Sleeper tracking JSON.
 *
 * Usage:
 *   node scripts/seed-tds-keepers.mjs <leagueId> <source.json> [planningYear]
 *
 * source.json — path to the pre-Sleeper keeper tracking JSON
 * planningYear defaults to the league's current season from Sleeper.
 *
 * Each entry's baseCost is derived from round_drafted (or free_agent_cost for FA
 * acquisitions) using the same formula as the app: max(5, 80 - 5 * round).
 * yearsKept is the number of seasons already kept (planningYear - year_acquired - 1),
 * matching calcKeeperCost: 0 = first keeper year = 1.2× base.
 *
 * Writes are idempotent — re-running will overwrite with the same values.
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Bootstrap ──────────────────────────────────────────────────────────────────

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

// ── Formula (mirrors keepers.ts) ───────────────────────────────────────────────

function roundToBaseCost(round) {
	return Math.max(5, 80 - 5 * round);
}

// ── Main ───────────────────────────────────────────────────────────────────────

const [leagueId, sourcePath, yearArg] = process.argv.slice(2);
if (!leagueId || !sourcePath) {
	console.error('Usage: node scripts/seed-tds-keepers.mjs <leagueId> <source.json> [planningYear]');
	process.exit(1);
}
const SOURCE = sourcePath;

// Default to the league's own season from Sleeper, not the calendar year.
let planningYear;
if (yearArg) {
	planningYear = parseInt(yearArg, 10);
} else {
	const league = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`).then(r => r.json());
	planningYear = parseInt(league.season, 10);
	console.log(`(planningYear from Sleeper: ${planningYear})`);
}
console.log(`League: ${leagueId}  |  Planning year: ${planningYear}`);
console.log(`Source: ${SOURCE}\n`);

const raw = JSON.parse(readFileSync(SOURCE, 'utf-8'));
const entries = Object.entries(raw);
console.log(`Found ${entries.length} players\n`);

const col = db.collection('keeperData').doc(leagueId).collection('players');
const batch = db.batch();

for (const [playerId, info] of entries) {
	const baseCost = info.acquisition_type === 'fa'
		? (info.free_agent_cost ?? 5)
		: roundToBaseCost(info.round_drafted);

	// yearsKept counts seasons already kept, not seasons rostered: a player
	// acquired in the season before the planning year has been kept zero times,
	// so keeping them now is their first keeper year (1.2× base).
	const yearsKept = Math.max(0, planningYear - info.year_acquired - 1);

	batch.set(col.doc(playerId), { baseOverride: baseCost, yearsKept }, { merge: true });

	console.log(
		`  ${playerId.padEnd(8)}  ${info.acquisition_type.padEnd(5)}  ` +
		`base=$${String(baseCost).padStart(2)}  yearsKept=${yearsKept}  (yr${yearsKept + 1})`
	);
}

await batch.commit();
console.log(`\nDone — ${entries.length} player(s) written to keeperData/${leagueId}/players`);
