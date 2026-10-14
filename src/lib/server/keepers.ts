import { adminDb } from '$lib/firebase/admin';
import { avatarUrl } from '$lib/sleeper';
import { roundToBaseCost, calcKeeperCost } from '$lib/keeperCost';
import { resolveKeeperHistory } from '$lib/keeperHistory';
import type { DraftHistory } from '$lib/keeperHistory';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';
import { getLeagueConfig } from '$lib/server/config';
import { getPlayers } from '$lib/server/players';
import type { SleeperLeague, SleeperRoster, SleeperLeagueUser, SleeperDraft, SleeperDraftPick } from '$lib/types';

export interface KeeperPlayerData {
	playerId: string;
	name: string;
	pos: string;
	team: string;
	rosterId: number;
	ownerUserId: string;
	ownerName: string;
	draftRound: number | null;
	draftSeason: string | null;
	/** Season the player was acquired (drafted, or added off waivers/FA). */
	acquiredSeason: string | null;
	baseOverride: number | null;
	baseCost: number;
	yearsKept: number;
	yearsKeptOverridden: boolean;
	keeperCost: number;
}

export interface KeeperRosterData {
	rosterId: number;
	ownerUserId: string;
	ownerName: string;
	ownerAvatar: string | null;
	players: KeeperPlayerData[];
	/** FAAB remaining before keeper deductions (budget - waiver_budget_used) */
	faabRemaining: number;
}

interface KeeperOverride { yearsKept?: number; baseOverride?: number | null }

async function sleeperGet<T>(path: string): Promise<T> {
	const res = await fetch(`https://api.sleeper.app/v1${path}`, { signal: AbortSignal.timeout(5000) });
	if (!res.ok) throw new Error(`Sleeper ${path} → ${res.status}`);
	return res.json();
}

/**
 * Walk the league lineage newest → oldest and record every draft pick, keyed by
 * season. Keeper picks are kept, not skipped: `is_keeper` is the only hard
 * evidence that a player was held over, and resolveKeeperHistory needs it to
 * count keeper years. See src/lib/keeperHistory.ts for the reasoning.
 */
async function walkDraftHistory(startLeagueId: string): Promise<DraftHistory> {
	const result: DraftHistory = {};
	let currentId: string | null = startLeagueId;

	while (currentId && currentId !== '0') {
		let league: SleeperLeague;
		try { league = await sleeperGet<SleeperLeague>(`/league/${currentId}`); }
		catch { break; }

		const season: string = league.season;
		let drafts: SleeperDraft[] = [];
		try { drafts = await sleeperGet<SleeperDraft[]>(`/league/${currentId}/drafts`); }
		catch { /* skip */ }

		for (const draft of (drafts ?? [])) {
			let picks: SleeperDraftPick[] = [];
			try { picks = await sleeperGet<SleeperDraftPick[]>(`/draft/${draft.draft_id}/picks`); }
			catch { continue; }

			// Only mark the season as covered once a draft actually loaded, so a
			// failed fetch leaves a hole rather than an empty season that would
			// read as "nobody was kept that year".
			const bySeason = (result[season] ??= {});

			for (const pick of (picks ?? [])) {
				if (!pick.player_id) continue;
				const isKeeper = pick.is_keeper === true;
				const existing = bySeason[pick.player_id];
				// A season can host more than one draft (e.g. a rookie draft). Keep
				// the first pick seen, but let a real draft pick displace a keeper
				// entry — the ordinary pick is what anchors base cost.
				if (existing && !(existing.isKeeper && !isKeeper)) continue;
				bySeason[pick.player_id] = {
					round: pick.round,
					isKeeper,
					rosterId: pick.roster_id ?? null,
				};
			}
		}

		currentId = league.previous_league_id ?? null;
	}

	return result;
}

// Bump when walk logic changes — forces a rebuild of any existing stored history.
const DRAFT_HISTORY_SCHEMA_VERSION = 3;

async function getCachedDraftHistory(leagueId: string): Promise<DraftHistory> {
	const ref = adminDb().collection('keeperDraftHistory').doc(leagueId);
	try {
		const doc = await ref.get();
		if (doc.exists) {
			const stored = doc.data()!;
			if (stored.schemaVersion === DRAFT_HISTORY_SCHEMA_VERSION) {
				return stored.data as DraftHistory;
			}
			// Schema mismatch — fall through to re-walk
		}
	} catch { /* miss */ }

	const history = await walkDraftHistory(leagueId);
	// Never cache an empty walk — that only happens when Sleeper was unreachable,
	// and persisting it would freeze every player at "never kept".
	if (Object.keys(history).length > 0) {
		ref.set({
			schemaVersion: DRAFT_HISTORY_SCHEMA_VERSION,
			walkedAt: new Date().toISOString(),
			data: history,
		}).catch(e => console.error('[keepers] Failed to write draft history:', e));
	}
	return history;
}


const POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
function posRank(pos: string) {
	const i = POS_ORDER.indexOf(pos);
	return i === -1 ? POS_ORDER.length : i;
}

export async function getKeeperData(leagueId: string): Promise<{
	rosters: KeeperRosterData[];
	planningYear: string;
	maxKeepers: number;
	faabBudget: number;
}> {
	const [league, rostersRaw, usersRaw] = await Promise.all([
		sleeperGet<SleeperLeague>(`/league/${leagueId}`),
		sleeperGet<SleeperRoster[]>(`/league/${leagueId}/rosters`),
		sleeperGet<SleeperLeagueUser[]>(`/league/${leagueId}/users`),
	]);

	// league.season is the season currently being built — keepers are held for this
	// year. Keeper years are counted back from (season - 1) using Sleeper's
	// `is_keeper` flags, not guessed from the gap since a player's draft.
	const planningYear = league.season as string;
	const planningYearNum = parseInt(planningYear, 10);
	const faabBudget: number = league.settings?.waiver_budget ?? 100;
	// Sleeper exposes the keeper cap as `max_keepers`; fall back to the legacy
	// `num_keepers` field if a league only has that set.
	const maxKeepers: number = league.settings?.max_keepers ?? league.settings?.num_keepers ?? 0;

	const sleeperUserIds: string[] = (usersRaw ?? []).map((u) => u.user_id).filter(Boolean);

	const [draftHistory, overridesSnap, playersCache, managerProfiles, leagueConfig] = await Promise.all([
		getCachedDraftHistory(leagueId),
		adminDb().collection('keeperData').doc(leagueId).collection('players').get(),
		getPlayers(),
		getManagerProfilesBatch(sleeperUserIds),
		getLeagueConfig(leagueId),
	]);

	const faabBonuses: Record<string, number> = leagueConfig.faabBonuses ?? {};

	const userMap = new Map<string, { name: string; avatar: string | null }>();
	for (const u of (usersRaw ?? [])) {
		const displayName = managerProfiles.get(u.user_id)?.displayName;
		userMap.set(u.user_id, {
			name: displayName || u.metadata?.team_name || u.display_name || u.username || u.user_id,
			avatar: avatarUrl(u.metadata?.avatar ?? u.avatar),
		});
	}

	const overrides = new Map<string, KeeperOverride>();
	overridesSnap.forEach(doc => overrides.set(doc.id, doc.data() as KeeperOverride));

	const rosters: KeeperRosterData[] = [];

	for (const roster of (rostersRaw ?? [])) {
		const ownerUserId: string = roster.owner_id ?? '';
		const ownerInfo = userMap.get(ownerUserId);
		const ownerName = ownerInfo?.name ?? `Roster ${roster.roster_id}`;
		const ownerAvatar = ownerInfo?.avatar ?? null;
		const faabBonus = faabBonuses[String(roster.roster_id)] ?? 0;
		const faabRemaining = faabBudget - (roster.settings?.waiver_budget_used ?? 0) + faabBonus;

		const players: KeeperPlayerData[] = [];

		for (const playerId of (roster.players ?? [])) {
			const p = playersCache[playerId];
			const history = resolveKeeperHistory(draftHistory, playerId, planningYearNum);
			const ov = overrides.get(playerId);

			const yearsKeptOverridden = ov?.yearsKept !== undefined;
			const yearsKept = yearsKeptOverridden ? ov!.yearsKept! : history.yearsKept;

			const draftRound = history.draftRound;
			const draftSeason = history.draftSeason;
			const baseOverride = ov?.baseOverride ?? null;
			const baseCost = baseOverride !== null
				? baseOverride
				: draftRound !== null
					? roundToBaseCost(draftRound)
					: 5; // undrafted (FAAB/waiver) — floor cost

			const keeperCost = calcKeeperCost(baseCost, yearsKept);

			players.push({
				playerId,
				name: p?.name ?? playerId,
				pos: p?.pos ?? '?',
				team: p?.team ?? 'FA',
				rosterId: roster.roster_id,
				ownerUserId,
				ownerName,
				draftRound,
				draftSeason,
				acquiredSeason: history.acquiredSeason,
				baseOverride,
				baseCost,
				yearsKept,
				yearsKeptOverridden,
				keeperCost,
			});
		}

		players.sort((a, b) => posRank(a.pos) - posRank(b.pos) || a.name.localeCompare(b.name));
		rosters.push({ rosterId: roster.roster_id, ownerUserId, ownerName, ownerAvatar, players, faabRemaining });
	}

	rosters.sort((a, b) => a.ownerName.localeCompare(b.ownerName));
	return { rosters, planningYear, maxKeepers, faabBudget };
}

export interface KeeperSelection {
	ownerUserId: string;
	rosterId: number;
	playerIds: string[];
	submittedAt: string;
}

export async function getKeeperSelections(leagueId: string): Promise<KeeperSelection[]> {
	const snap = await adminDb()
		.collection('keeperSelections')
		.doc(leagueId)
		.collection('managers')
		.get();
	return snap.docs.map(d => d.data() as KeeperSelection);
}

export async function setKeeperSelection(
	leagueId: string,
	ownerUserId: string,
	rosterId: number,
	playerIds: string[],
): Promise<KeeperSelection> {
	const selection: KeeperSelection = {
		ownerUserId,
		rosterId,
		playerIds,
		submittedAt: new Date().toISOString(),
	};
	await adminDb()
		.collection('keeperSelections')
		.doc(leagueId)
		.collection('managers')
		.doc(ownerUserId)
		.set(selection);
	return selection;
}

export function clearKeeperSelection(leagueId: string, ownerUserId: string) {
	return adminDb()
		.collection('keeperSelections')
		.doc(leagueId)
		.collection('managers')
		.doc(ownerUserId)
		.delete();
}
