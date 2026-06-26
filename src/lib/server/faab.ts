import { getLeagueConfig, leagueConfigKey, type FaabTransaction, type LeagueConfig } from '$lib/server/config';
import { adminDb } from '$lib/firebase/admin';
import { deleteCache } from '$lib/server/cache';

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

/** Sum each roster's adjustments into the net map consumers read. */
export function netFromLedger(txns: FaabTransaction[]): Record<string, number> {
	const net: Record<string, number> = {};
	for (const t of txns) net[t.rosterId] = (net[t.rosterId] ?? 0) + t.amount;
	// Drop zeroed-out rosters so the stored map stays tidy.
	for (const k of Object.keys(net)) if (net[k] === 0) delete net[k];
	return net;
}

/**
 * The effective ledger for a league. If a transaction list exists it's the
 * source of truth; otherwise synthesize "Opening balance" entries from the
 * legacy per-roster faabBonuses so existing budgets are preserved and shown.
 */
export function resolveLedger(config: LeagueConfig): FaabTransaction[] {
	if (config.faabTransactions && config.faabTransactions.length > 0) {
		return [...config.faabTransactions];
	}
	const legacy = config.faabBonuses ?? {};
	return Object.entries(legacy)
		.filter(([, amount]) => amount !== 0)
		.map(([rosterId, amount]) => ({
			id: `opening-${rosterId}`,
			rosterId,
			amount,
			reason: 'Opening balance',
			createdAt: 0,
			createdBy: 'Migration',
			isMigration: true,
		}));
}

/** Newest-first ledger for display. */
export function sortLedger(txns: FaabTransaction[]): FaabTransaction[] {
	return [...txns].sort((a, b) => b.createdAt - a.createdAt);
}

// ── Firestore-backed operations ───────────────────────────────────────────────

/** Read the league's FAAB ledger (newest first), migrating legacy bonuses. */
export async function getFaabLedger(leagueId: string): Promise<FaabTransaction[]> {
	const config = await getLeagueConfig(leagueId);
	return sortLedger(resolveLedger(config));
}

/**
 * Atomically mutate the ledger inside a Firestore transaction so concurrent
 * admin writes can't clobber each other (read-modify-write race). Writes the
 * transactions and the derived net map together, then evicts the config cache.
 */
async function mutateLedger(
	leagueId: string,
	mutate: (ledger: FaabTransaction[]) => FaabTransaction[],
): Promise<void> {
	const ref = adminDb().collection('leagueConfig').doc(leagueId);
	await adminDb().runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		const config = (snap.exists ? snap.data() : {}) as LeagueConfig;
		const next = mutate(resolveLedger(config));
		tx.set(ref, { faabTransactions: next, faabBonuses: netFromLedger(next) }, { merge: true });
	});
	await deleteCache(leagueConfigKey(leagueId));
}

export async function addFaabTransaction(
	leagueId: string,
	entry: { rosterId: string; amount: number; reason: string; createdBy: string },
): Promise<FaabTransaction> {
	const txn: FaabTransaction = {
		id: crypto.randomUUID(),
		rosterId: entry.rosterId,
		amount: entry.amount,
		reason: entry.reason,
		createdAt: Date.now(),
		createdBy: entry.createdBy,
	};
	// resolveLedger inside the transaction migrates legacy bonuses on first write.
	await mutateLedger(leagueId, (ledger) => [...ledger, txn]);
	return txn;
}

export async function deleteFaabTransaction(leagueId: string, txnId: string): Promise<void> {
	await mutateLedger(leagueId, (ledger) => ledger.filter((t) => t.id !== txnId));
}
