/**
 * Spot-check keeper overrides and computed costs for a league.
 * Usage: node scripts/check-keeper-costs.mjs <leagueId> [planningYear]
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
const db = getFirestore();

function roundToBaseCost(round) { return Math.max(5, 80 - 5 * round); }
function calcKeeperCost(base, years) {
	const eff = base < 1 ? 5 : base;
	return Math.ceil(eff * (1 + 0.2 * (years + 1)));
}

const [leagueId, yearArg] = process.argv.slice(2);
if (!leagueId) { console.error('Usage: node scripts/check-keeper-costs.mjs <leagueId> [planningYear]'); process.exit(1); }
const planningYear = yearArg ? parseInt(yearArg, 10) : new Date().getFullYear();

const snap = await db.collection('keeperData').doc(leagueId).collection('players').get();
if (snap.empty) { console.log('No overrides found.'); process.exit(0); }

// Also fetch player names from cache
const playersDoc = await db.collection('cache').doc('players_nfl').get();
const players = playersDoc.exists ? JSON.parse(playersDoc.data().data) : {};

console.log(`League ${leagueId}  |  Planning year ${planningYear}\n`);
console.log('Player ID  Name                           Base   Yr#  Cost');
console.log('─────────────────────────────────────────────────────────────');

const rows = [];
snap.docs.forEach(doc => {
	const { baseOverride, yearsKept } = doc.data();
	const base = baseOverride ?? 5;
	const cost = calcKeeperCost(base, yearsKept ?? 0);
	const p = players[doc.id];
	const name = p ? `${p.name} (${p.pos})` : doc.id;
	rows.push({ id: doc.id, name, base, yearsKept: yearsKept ?? 0, cost });
});

rows.sort((a, b) => b.cost - a.cost);

for (const r of rows) {
	console.log(
		`${r.id.padEnd(10)} ${r.name.padEnd(30)}  $${String(r.base).padStart(2)}   yr${r.yearsKept + 1}  $${r.cost}`
	);
}

const total = rows.reduce((s, r) => s + r.cost, 0);
console.log('─────────────────────────────────────────────────────────────');
console.log(`${rows.length} players  |  Total if all kept: $${total}`);
