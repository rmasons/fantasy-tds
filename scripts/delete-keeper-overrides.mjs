/**
 * Delete all keeper overrides for a league.
 * Usage: node scripts/delete-keeper-overrides.mjs <leagueId>
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

const [leagueId] = process.argv.slice(2);
if (!leagueId) {
	console.error('Usage: node scripts/delete-keeper-overrides.mjs <leagueId>');
	process.exit(1);
}

const snap = await db.collection('keeperData').doc(leagueId).collection('players').get();
if (snap.empty) {
	console.log(`No overrides found for league ${leagueId}`);
	process.exit(0);
}

const batch = db.batch();
snap.docs.forEach(doc => batch.delete(doc.ref));
await batch.commit();
console.log(`Deleted ${snap.size} override(s) from keeperData/${leagueId}/players`);
