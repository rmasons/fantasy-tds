import { cachedFetch, writeCache, peekCache, cacheKey } from '$lib/server/cache';
import type { SleeperLeague, SleeperDraft, SleeperDraftPick, SleeperRoster, SleeperLeagueUser } from '$lib/types';

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function sleeperGet<T>(path: string): Promise<T> {
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

export interface DraftListPayload {
	drafts: SleeperDraft[];
	rosterInfo: Record<string, string>; // rosterId → teamName
}

function buildRosterInfo(rosters: SleeperRoster[], users: SleeperLeagueUser[]): Record<string, string> {
	const userMap = new Map(users.map((u) => [u.user_id, u]));
	const out: Record<string, string> = {};
	for (const r of rosters) {
		const u = userMap.get(r.owner_id);
		out[String(r.roster_id)] =
			u?.metadata?.team_name ?? u?.display_name ?? `Team ${r.roster_id}`;
	}
	return out;
}

export async function seedLeagueChain(startLeagueId: string): Promise<SeedDraftResult[]> {
	const results: SeedDraftResult[] = [];
	let currentId: string | null = startLeagueId;

	while (currentId && currentId !== '0') {
		let league: SleeperLeague;
		try {
			league = await sleeperGet<SleeperLeague>(`/league/${currentId}`);
		} catch (e) {
			console.error('[seed] Failed to fetch league', currentId, errMsg(e));
			break;
		}

		let drafts: SleeperDraft[] = [];
		try {
			const [fetchedDrafts, rosters, users] = await Promise.all([
				sleeperGet<SleeperDraft[]>(`/league/${currentId}/drafts`),
				sleeperGet<SleeperRoster[]>(`/league/${currentId}/rosters`),
				sleeperGet<SleeperLeagueUser[]>(`/league/${currentId}/users`),
			]);
			drafts = fetchedDrafts ?? [];
			const rosterInfo = buildRosterInfo(rosters ?? [], users ?? []);
			await writeCache<DraftListPayload>(cacheKey('draftListCache', currentId), { drafts, rosterInfo });
		} catch (e) {
			console.error('[seed] Failed to fetch/cache draft list for', currentId, errMsg(e));
		}

		for (const draft of drafts.filter((d) => d.status === 'complete')) {
			const draftId = draft.draft_id;
			const picksKey = cacheKey('draftPicksCache', draftId);
			const existing = await peekCache<SleeperDraftPick[]>(picksKey);
			if (existing) {
				results.push({
					leagueId: currentId,
					season: league.season,
					draftId,
					type: draft.type,
					picks: existing.value?.length ?? 0,
					status: 'already_cached',
				});
				continue;
			}

			try {
				const picks = await sleeperGet<SleeperDraftPick[]>(`/draft/${draftId}/picks`);
				await writeCache(picksKey, picks);
				results.push({
					leagueId: currentId,
					season: league.season,
					draftId,
					type: draft.type,
					picks: picks.length,
					status: picks.length === 0 ? 'empty' : 'seeded',
				});
			} catch (e) {
				results.push({
					leagueId: currentId,
					season: league.season,
					draftId,
					type: draft.type,
					picks: 0,
					status: 'error',
					error: errMsg(e),
				});
			}
		}

		currentId = league.previous_league_id ?? null;
	}

	return results;
}

// Completed draft picks are immutable — no TTL needed.
export function getCachedDraftPicks(draftId: string): Promise<SleeperDraftPick[]> {
	return cachedFetch(cacheKey('draftPicksCache', draftId), {
		fetcher: () => sleeperGet<SleeperDraftPick[]>(`/draft/${draftId}/picks`),
	});
}

const DRAFT_LIST_TTL_MS = 24 * 60 * 60 * 1000; // 24 h — new drafts are rare

export function getCachedDraftList(leagueId: string): Promise<DraftListPayload> {
	return cachedFetch<DraftListPayload>(cacheKey('draftListCache', leagueId), {
		ttlMs: DRAFT_LIST_TTL_MS,
		fetcher: async () => {
			const [drafts, rosters, users] = await Promise.all([
				sleeperGet<SleeperDraft[]>(`/league/${leagueId}/drafts`),
				sleeperGet<SleeperRoster[]>(`/league/${leagueId}/rosters`),
				sleeperGet<SleeperLeagueUser[]>(`/league/${leagueId}/users`),
			]);
			return { drafts, rosterInfo: buildRosterInfo(rosters ?? [], users ?? []) };
		},
	});
}
