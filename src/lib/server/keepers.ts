import { adminDb } from '$lib/firebase/admin';
import { avatarUrl } from '$lib/sleeper';

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
	baseOverride: number | null;
	baseCost: number | null;
	yearsKept: number;
	yearsKeptOverridden: boolean;
	keeperCost: number | null;
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

interface DraftPick { round: number; season: string }
interface KeeperOverride { yearsKept?: number; baseOverride?: number | null }

function roundToBaseCost(round: number): number {
	return Math.max(5, 80 - 5 * round); // R1=$75, R2=$70 …
}

function calcKeeperCost(baseCost: number, yearsKept: number): number {
	const effective = baseCost < 1 ? 5 : baseCost;
	return Math.ceil(effective * (1 + 0.2 * yearsKept));
}

async function sleeperGet(path: string): Promise<any> {
	const res = await fetch(`https://api.sleeper.app/v1${path}`, { signal: AbortSignal.timeout(5000) });
	if (!res.ok) throw new Error(`Sleeper ${path} → ${res.status}`);
	return res.json();
}

async function walkDraftHistory(startLeagueId: string): Promise<Map<string, DraftPick>> {
	const result = new Map<string, DraftPick>();
	let currentId: string | null = startLeagueId;

	while (currentId && currentId !== '0') {
		let league: any;
		try { league = await sleeperGet(`/league/${currentId}`); }
		catch { break; }

		const season: string = league.season;
		let drafts: any[] = [];
		try { drafts = await sleeperGet(`/league/${currentId}/drafts`); }
		catch { /* skip */ }

		for (const draft of (drafts ?? [])) {
			let picks: any[] = [];
			try { picks = await sleeperGet(`/draft/${draft.draft_id}/picks`); }
			catch { continue; }

			for (const pick of (picks ?? [])) {
				// Skip keeper picks — they appear in the draft but are carries from prior years.
				// We want the original non-keeper draft (the true base cost and draft year).
				// Walking newest → oldest means first non-keeper occurrence = most recent fresh draft.
				if (pick.is_keeper === true) continue;
				if (pick.player_id && !result.has(pick.player_id)) {
					result.set(pick.player_id, { round: pick.round, season });
				}
			}
		}

		currentId = league.previous_league_id ?? null;
	}

	return result;
}

// Bump when walk logic changes — forces a rebuild of any existing stored history.
const DRAFT_HISTORY_SCHEMA_VERSION = 2;

async function getCachedDraftHistory(leagueId: string): Promise<Map<string, DraftPick>> {
	const ref = adminDb.collection('keeperDraftHistory').doc(leagueId);
	try {
		const doc = await ref.get();
		if (doc.exists) {
			const stored = doc.data()!;
			if (stored.schemaVersion === DRAFT_HISTORY_SCHEMA_VERSION) {
				return new Map(Object.entries(stored.data as Record<string, DraftPick>));
			}
			// Schema mismatch — fall through to re-walk
		}
	} catch { /* miss */ }

	const history = await walkDraftHistory(leagueId);
	ref.set({
		schemaVersion: DRAFT_HISTORY_SCHEMA_VERSION,
		walkedAt: new Date().toISOString(),
		data: Object.fromEntries(history),
	}).catch(e => console.error('[keepers] Failed to write draft history:', e));
	return history;
}

let playersCacheData: Record<string, { name: string; pos: string; team: string }> | null = null;
let playersCacheExpiry = 0;
const PLAYERS_CACHE_TTL_MS = 5 * 60 * 1000;

async function getPlayersCache(): Promise<Record<string, { name: string; pos: string; team: string }>> {
	if (playersCacheData && Date.now() < playersCacheExpiry) return playersCacheData;
	const doc = await adminDb.collection('cache').doc('players_nfl').get();
	const fresh: Record<string, { name: string; pos: string; team: string }> =
		doc.exists ? JSON.parse(doc.data()!.data) : {};
	playersCacheData = fresh;
	playersCacheExpiry = Date.now() + PLAYERS_CACHE_TTL_MS;
	return fresh;
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
		sleeperGet(`/league/${leagueId}`),
		sleeperGet(`/league/${leagueId}/rosters`),
		sleeperGet(`/league/${leagueId}/users`),
	]);

	// league.season is the season currently being built — keepers are held for this year.
	// A player drafted in (season - 1) is in their first year kept.
	const planningYear = league.season as string;
	const faabBudget: number = league.settings?.waiver_budget ?? 100;
	const maxKeepers: number = league.settings?.num_keepers ?? 0;

	const userMap = new Map<string, { name: string; avatar: string | null }>();
	for (const u of (usersRaw ?? [])) {
		userMap.set(u.user_id, {
			name: u.metadata?.team_name || u.display_name || u.username || u.user_id,
			avatar: avatarUrl(u.metadata?.avatar ?? u.avatar),
		});
	}

	const [draftHistory, overridesSnap, playersCache] = await Promise.all([
		getCachedDraftHistory(leagueId),
		adminDb.collection('keeperData').doc(leagueId).collection('players').get(),
		getPlayersCache(),
	]);

	const overrides = new Map<string, KeeperOverride>();
	overridesSnap.forEach(doc => overrides.set(doc.id, doc.data() as KeeperOverride));

	const rosters: KeeperRosterData[] = [];

	for (const roster of (rostersRaw ?? [])) {
		const ownerUserId: string = roster.owner_id ?? '';
		const ownerInfo = userMap.get(ownerUserId);
		const ownerName = ownerInfo?.name ?? `Roster ${roster.roster_id}`;
		const ownerAvatar = ownerInfo?.avatar ?? null;
		const faabRemaining = faabBudget - (roster.settings?.waiver_budget_used ?? 0);

		const players: KeeperPlayerData[] = [];

		for (const playerId of (roster.players ?? [])) {
			const p = playersCache[playerId];
			const draftInfo = draftHistory.get(playerId);
			const ov = overrides.get(playerId);

			const yearsKeptOverridden = ov?.yearsKept !== undefined;
			const yearsKept = yearsKeptOverridden
				? ov!.yearsKept!
				: draftInfo
					? parseInt(planningYear, 10) - parseInt(draftInfo.season, 10)
					: 0;

			const draftRound = draftInfo?.round ?? null;
			const draftSeason = draftInfo?.season ?? null;
			const baseOverride = ov?.baseOverride ?? null;
			const baseCost = baseOverride !== null
				? baseOverride
				: draftRound !== null
					? roundToBaseCost(draftRound)
					: null;

			const keeperCost = baseCost !== null ? calcKeeperCost(baseCost, yearsKept) : null;

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

export async function setPlayerOverride(
	leagueId: string,
	playerId: string,
	patch: { yearsKept?: number; baseOverride?: number | null },
) {
	const ref = adminDb
		.collection('keeperData')
		.doc(leagueId)
		.collection('players')
		.doc(playerId);

	const update: Record<string, unknown> = {};
	if (patch.yearsKept !== undefined) update.yearsKept = patch.yearsKept;
	if ('baseOverride' in patch) update.baseOverride = patch.baseOverride ?? null;

	await ref.set(update, { merge: true });
}

export async function importPlayers(
	leagueId: string,
	entries: { playerId: string; baseCost?: number | null; yearsKept?: number }[],
) {
	const batch = adminDb.batch();
	const col = adminDb.collection('keeperData').doc(leagueId).collection('players');

	for (const entry of entries) {
		const ref = col.doc(entry.playerId);
		const data: Record<string, unknown> = {};
		if (entry.baseCost !== undefined) data.baseOverride = entry.baseCost ?? null;
		if (entry.yearsKept !== undefined) data.yearsKept = entry.yearsKept;
		if (Object.keys(data).length) batch.set(ref, data, { merge: true });
	}

	await batch.commit();
}

export function resetPlayerOverride(leagueId: string, playerId: string) {
	return adminDb
		.collection('keeperData')
		.doc(leagueId)
		.collection('players')
		.doc(playerId)
		.delete();
}

export function invalidateDraftCache(leagueId: string) {
	return adminDb.collection('keeperDraftHistory').doc(leagueId).delete();
}
