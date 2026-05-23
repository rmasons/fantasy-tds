import { adminDb } from '$lib/firebase/admin';

async function sleeperGet(path: string): Promise<any> {
	const res = await fetch(`https://api.sleeper.app/v1${path}`, {
		signal: AbortSignal.timeout(10000),
	});
	if (!res.ok) throw new Error(`Sleeper ${path} → ${res.status}`);
	return res.json();
}

// Completed draft picks are immutable — no TTL needed.
export async function getCachedDraftPicks(draftId: string): Promise<any[]> {
	const ref = adminDb.collection('draftPicksCache').doc(draftId);
	try {
		const doc = await ref.get();
		if (doc.exists) return doc.data()!.picks as any[];
	} catch { /* cache miss */ }

	const picks = await sleeperGet(`/draft/${draftId}/picks`);
	ref.set({ picks, cachedAt: new Date().toISOString() })
		.catch(e => console.error('[drafts] Failed to cache picks for', draftId, ':', e));
	return picks;
}

const DRAFT_LIST_TTL_MS = 24 * 60 * 60 * 1000; // 24 h — new drafts are rare

export async function getCachedDraftList(leagueId: string): Promise<any[]> {
	const ref = adminDb.collection('draftListCache').doc(leagueId);
	try {
		const doc = await ref.get();
		if (doc.exists) {
			const d = doc.data()!;
			if (Date.now() - new Date(d.cachedAt).getTime() < DRAFT_LIST_TTL_MS) {
				return d.drafts as any[];
			}
		}
	} catch { /* cache miss */ }

	const drafts = await sleeperGet(`/league/${leagueId}/drafts`);
	ref.set({ drafts, cachedAt: new Date().toISOString() })
		.catch(e => console.error('[drafts] Failed to cache draft list for', leagueId, ':', e));
	return drafts;
}
