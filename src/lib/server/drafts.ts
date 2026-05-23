import { adminDb } from '$lib/firebase/admin';

async function sleeperGet(path: string): Promise<any> {
	const res = await fetch(`https://api.sleeper.app/v1${path}`, {
		signal: AbortSignal.timeout(10000),
	});
	if (!res.ok) throw new Error(`Sleeper ${path} → ${res.status}`);
	return res.json();
}

export interface SeedDraftResult {
	leagueId: string;
	season: string;
	draftId: string;
	type: string;
	picks: number;
	status: 'seeded' | 'already_cached' | 'empty' | 'error';
	error?: string;
}

export async function seedLeagueChain(startLeagueId: string): Promise<SeedDraftResult[]> {
	const results: SeedDraftResult[] = [];
	let currentId: string | null = startLeagueId;

	while (currentId && currentId !== '0') {
		let league: any;
		try {
			league = await sleeperGet(`/league/${currentId}`);
		} catch (e: any) {
			console.error('[seed] Failed to fetch league', currentId, e.message);
			break;
		}

		let drafts: any[] = [];
		try {
			drafts = (await sleeperGet(`/league/${currentId}/drafts`)) ?? [];
			await adminDb.collection('draftListCache').doc(currentId).set({
				drafts,
				cachedAt: new Date().toISOString(),
			});
		} catch (e: any) {
			console.error('[seed] Failed to fetch/cache draft list for', currentId, e.message);
		}

		for (const draft of drafts.filter((d: any) => d.status === 'complete')) {
			const draftId: string = draft.draft_id;
			try {
				const existing = await adminDb.collection('draftPicksCache').doc(draftId).get();
				if (existing.exists) {
					results.push({
						leagueId: currentId,
						season: league.season,
						draftId,
						type: draft.type,
						picks: existing.data()!.picks?.length ?? 0,
						status: 'already_cached',
					});
					continue;
				}
			} catch { /* proceed to fetch */ }

			try {
				const picks = await sleeperGet(`/draft/${draftId}/picks`);
				await adminDb.collection('draftPicksCache').doc(draftId).set({
					picks,
					cachedAt: new Date().toISOString(),
				});
				results.push({
					leagueId: currentId,
					season: league.season,
					draftId,
					type: draft.type,
					picks: picks.length,
					status: picks.length === 0 ? 'empty' : 'seeded',
				});
			} catch (e: any) {
				results.push({
					leagueId: currentId,
					season: league.season,
					draftId,
					type: draft.type,
					picks: 0,
					status: 'error',
					error: e.message,
				});
			}
		}

		currentId = league.previous_league_id ?? null;
	}

	return results;
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
