import { adminDb } from '$lib/firebase/admin';
import { cachedFetch } from '$lib/server/cache';
import { fetchLeagueCore, fetchNflState, fetchTransactions, buildRosterInfoMap, type RosterInfo } from '$lib/sleeper';
import { getCachedTransactions } from '$lib/server/sleeperCache';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';
import { getPlayers } from '$lib/server/players';
import type { SlimPlayer } from '$lib/types';

const SCHEMA_VERSION = 1;
const TTL_MS = 15 * 60 * 1000;

export interface TxMove {
	type: 'add' | 'drop' | 'pick';
	player?: string;
	round?: number;
	season?: string;
	rosterId: number;
}

export interface Transaction {
	id: string;
	type: 'trade' | 'waiver' | 'free_agent';
	date: number; // epoch ms — formatted client-side in the viewer's locale
	rosterIds: number[];
	moves: TxMove[];
}

export interface TransactionsData {
	transactions: Transaction[];
	rosterInfo: Record<string, RosterInfo>; // rosterId -> info; client rebuilds the Map
	players: Record<string, SlimPlayer>; // subset referenced by transactions
	status: string;
}

async function buildTransactions(leagueId: string): Promise<TransactionsData> {
	const [{ league, rosters, users }, nfl] = await Promise.all([fetchLeagueCore(leagueId), fetchNflState()]);

	const profiles = await getManagerProfilesBatch(rosters.map((r) => r.owner_id).filter(Boolean));
	const overrides = new Map<string, string>();
	for (const [uid, p] of profiles) if (p.displayName) overrides.set(uid, p.displayName);
	const rosterInfoMap = buildRosterInfoMap(rosters, users, overrides);

	let week: number;
	if (league.status === 'complete') {
		week = 18;
	} else {
		week = nfl.season_type === 'regular' ? nfl.week : nfl.season_type === 'post' ? 18 : 1;
		week = Math.max(week, 1);
	}

	// Weeks before the current NFL week are immutable (use the cache); the
	// current/future week can still change, so fetch it live.
	const liveFrom = league.status === 'complete' ? Infinity : nfl.week;
	const weekNums = Array.from({ length: week }, (_, i) => i + 1);
	const txWeeks = await Promise.all(
		weekNums.map((w) => (w < liveFrom ? getCachedTransactions(leagueId, w) : fetchTransactions(leagueId, w)))
	);

	const raw = txWeeks.flat().filter((t) => t.status === 'complete');
	raw.sort((a, b) => b.status_updated - a.status_updated);

	const transactions: Transaction[] = raw.map((t) => {
		const moves: TxMove[] = [];
		for (const [pid, rid] of Object.entries(t.adds ?? {})) moves.push({ type: 'add', player: pid, rosterId: rid });
		for (const [pid, rid] of Object.entries(t.drops ?? {})) moves.push({ type: 'drop', player: pid, rosterId: rid });
		for (const pick of t.draft_picks ?? []) moves.push({ type: 'pick', round: pick.round, season: pick.season, rosterId: pick.owner_id });
		return {
			id: t.transaction_id,
			type: t.type as Transaction['type'],
			date: t.status_updated,
			rosterIds: t.roster_ids,
			moves,
		};
	});

	// Only ship the players actually referenced (keeps the payload small).
	const allPlayers = await getPlayers();
	const referenced = new Set<string>();
	for (const tx of transactions) for (const m of tx.moves) if (m.player) referenced.add(m.player);
	const players: Record<string, SlimPlayer> = {};
	for (const id of referenced) if (allPlayers[id]) players[id] = allPlayers[id];

	const rosterInfo: Record<string, RosterInfo> = {};
	for (const [rid, info] of rosterInfoMap) rosterInfo[String(rid)] = info;

	return { transactions, rosterInfo, players, status: league.status };
}

export function getTransactions(leagueId: string): Promise<TransactionsData> {
	return cachedFetch<TransactionsData>(adminDb().collection('transactionsViewCache').doc(leagueId), {
		schemaVersion: SCHEMA_VERSION,
		isFresh: (env) =>
			env.schemaVersion === SCHEMA_VERSION && (env.value.status === 'complete' || Date.now() - env.cachedAt < TTL_MS),
		fetcher: () => buildTransactions(leagueId),
	});
}
