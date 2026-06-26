import { getLeagueConfig, setLeagueConfig, type FaabTransaction, type LeagueConfig } from '$lib/server/config';

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

/** Persist a ledger: write the transactions and the derived net map together. */
async function writeLedger(leagueId: string, txns: FaabTransaction[]): Promise<void> {
	await setLeagueConfig(leagueId, {
		faabTransactions: txns,
		faabBonuses: netFromLedger(txns),
	});
}

export async function addFaabTransaction(
	leagueId: string,
	entry: { rosterId: string; amount: number; reason: string; createdBy: string },
): Promise<FaabTransaction> {
	const config = await getLeagueConfig(leagueId);
	const ledger = resolveLedger(config); // migrates legacy bonuses on first write
	const txn: FaabTransaction = {
		id: crypto.randomUUID(),
		rosterId: entry.rosterId,
		amount: entry.amount,
		reason: entry.reason,
		createdAt: Date.now(),
		createdBy: entry.createdBy,
	};
	await writeLedger(leagueId, [...ledger, txn]);
	return txn;
}

export async function deleteFaabTransaction(leagueId: string, txnId: string): Promise<void> {
	const config = await getLeagueConfig(leagueId);
	const ledger = resolveLedger(config);
	await writeLedger(leagueId, ledger.filter((t) => t.id !== txnId));
}
