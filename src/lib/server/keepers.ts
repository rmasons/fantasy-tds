import { adminDb } from '$lib/firebase/admin';

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
}

interface DraftPick { round: number; season: string }
interface KeeperOverride { yearsKept?: number; baseOverride?: number | null }

function roundToBaseCost(round: number): number {
	return 80 - 5 * round; // R1=$75, R2=$70 …
}

function calcKeeperCost(baseCost: number, yearsKept: number): number {
	const effective = baseCost < 1 ? 5 : baseCost;
	return Math.ceil(effective * (1 + 0.2 * yearsKept));
}

async function sleeperGet(path: string): Promise<any> {
	const res = await fetch(`https://api.sleeper.app/v1${path}`);
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
				// Walking newest → oldest: first occurrence is most recent draft
				if (pick.player_id && !result.has(pick.player_id)) {
					result.set(pick.player_id, { round: pick.round, season });
				}
			}
		}

		currentId = league.previous_league_id ?? null;
	}

	return result;
}

async function getCachedDraftHistory(leagueId: string): Promise<Map<string, DraftPick>> {
	const cacheRef = adminDb.collection('cache').doc(`keeperDrafts_${leagueId}`);
	try {
		const doc = await cacheRef.get();
		if (doc.exists) {
			const cached = doc.data()!;
			const ageMs = Date.now() - new Date(cached.cachedAt).getTime();
			if (ageMs < 7 * 24 * 60 * 60 * 1000) {
				return new Map(Object.entries(cached.data as Record<string, DraftPick>));
			}
		}
	} catch { /* cache miss */ }

	const history = await walkDraftHistory(leagueId);
	cacheRef.set({
		data: Object.fromEntries(history),
		cachedAt: new Date().toISOString(),
	}).catch(e => console.error('[keepers] Failed to write draft cache:', e));
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
}> {
	const [league, rostersRaw, usersRaw] = await Promise.all([
		sleeperGet(`/league/${leagueId}`),
		sleeperGet(`/league/${leagueId}/rosters`),
		sleeperGet(`/league/${leagueId}/users`),
	]);

	const planningYear = String(parseInt(league.season) + 1);

	const userMap = new Map<string, { name: string; avatar: string | null }>();
	for (const u of (usersRaw ?? [])) {
		userMap.set(u.user_id, {
			name: u.metadata?.team_name || u.display_name || u.username || u.user_id,
			avatar: u.avatar ?? null,
		});
	}

	const [draftHistory, overridesSnap, playersCacheDoc] = await Promise.all([
		getCachedDraftHistory(leagueId),
		adminDb.collection('keeperData').doc(leagueId).collection('players').get(),
		adminDb.collection('cache').doc('players_nfl').get(),
	]);

	const overrides = new Map<string, KeeperOverride>();
	overridesSnap.forEach(doc => overrides.set(doc.id, doc.data() as KeeperOverride));

	const playersCache: Record<string, { name: string; pos: string; team: string }> =
		playersCacheDoc.exists ? JSON.parse(playersCacheDoc.data()!.data) : {};

	const rosters: KeeperRosterData[] = [];

	for (const roster of (rostersRaw ?? [])) {
		const ownerUserId: string = roster.owner_id ?? '';
		const ownerInfo = userMap.get(ownerUserId);
		const ownerName = ownerInfo?.name ?? `Roster ${roster.roster_id}`;
		const ownerAvatar = ownerInfo?.avatar ?? null;

		const players: KeeperPlayerData[] = [];

		for (const playerId of (roster.players ?? [])) {
			const p = playersCache[playerId];
			const draftInfo = draftHistory.get(playerId);
			const ov = overrides.get(playerId);

			const yearsKeptOverridden = ov?.yearsKept !== undefined;
			const yearsKept = yearsKeptOverridden
				? ov!.yearsKept!
				: draftInfo
					? parseInt(planningYear) - parseInt(draftInfo.season)
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
		rosters.push({ rosterId: roster.roster_id, ownerUserId, ownerName, ownerAvatar, players });
	}

	rosters.sort((a, b) => a.ownerName.localeCompare(b.ownerName));
	return { rosters, planningYear };
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
	return adminDb.collection('cache').doc(`keeperDrafts_${leagueId}`).delete();
}
