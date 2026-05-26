import { adminDb } from '$lib/firebase/admin';
import type { RawMatchup } from '$lib/sleeper';

async function sleeperGet<T>(url: string): Promise<T> {
	const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
	if (!res.ok) throw new Error(`Sleeper ${res.status}: ${url}`);
	return res.json();
}

// Completed weeks are immutable — cache indefinitely.
// Pass bypassCache=true for in-progress seasons so live scores are always fresh.

export async function getCachedMatchups(leagueId: string, week: number, bypassCache = false): Promise<RawMatchup[]> {
	const ref = adminDb.collection('matchupCache').doc(`${leagueId}_${week}`);

	if (!bypassCache) {
		try {
			const doc = await ref.get();
			if (doc.exists) return doc.data()?.matchups as RawMatchup[] ?? [];
		} catch { /* cache miss */ }
	}

	const matchups = await sleeperGet<RawMatchup[]>(
		`https://api.sleeper.app/v1/league/${leagueId}/matchups/${week}`
	);
	if (!bypassCache) {
		ref.set({ matchups, cachedAt: new Date().toISOString() })
			.catch(e => console.error('[matchupCache] write failed:', e));
	}
	return matchups;
}

export async function getCachedTransactions(leagueId: string, week: number, bypassCache = false): Promise<any[]> {
	const ref = adminDb.collection('transactionCache').doc(`${leagueId}_${week}`);

	if (!bypassCache) {
		try {
			const doc = await ref.get();
			if (doc.exists) return doc.data()?.transactions as any[] ?? [];
		} catch { /* cache miss */ }
	}

	const transactions = await sleeperGet<any[]>(
		`https://api.sleeper.app/v1/league/${leagueId}/transactions/${week}`
	);
	if (!bypassCache) {
		ref.set({ transactions, cachedAt: new Date().toISOString() })
			.catch(e => console.error('[transactionCache] write failed:', e));
	}
	return transactions;
}
