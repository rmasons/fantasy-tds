/**
 * Pure trade & transaction analytics engine.
 *
 * Accepts already-fetched data — no network calls, no Firebase — so the
 * module is fully unit-testable. All external I/O belongs in the
 * getTradeAnalytics() wrapper that calls this engine.
 */

import type { SleeperTransaction, SlimPlayer } from '$lib/types';
import type { RosterInfo } from '$lib/sleeper';

// ── Public result types ────────────────────────────────────────────────────────

export interface TradeParty {
	rosterId: number;
	teamName: string;
	avatar: string | null;
	ownerId: string | null;
	/** Players/picks this party received in the trade */
	received: TradeAsset[];
	/** Players/picks this party gave away */
	gave: TradeAsset[];
}

export interface TradeAsset {
	type: 'player' | 'pick';
	/** Player display name, or pick description ("2024 Round 2") */
	label: string;
	playerId?: string;
}

export interface AnalyzedTrade {
	transactionId: string;
	date: number; // epoch ms
	week: number;
	/** Season this trade belongs to. Set by the all-time aggregator; undefined for a single-season result. */
	season?: string;
	parties: TradeParty[];
	/** Net roster-points gained by each party after the trade (post-trade starts) */
	pointSwings: Record<number, number>; // rosterId → net points gained
	/** Numeric margin separating the biggest winner from runner-up, in points */
	imbalanceScore: number;
	/**
	 * True when the trade includes draft picks. Picks have real value that can't
	 * be measured in points, so these trades are excluded from the lopsided
	 * ranking and their point swing isn't a "true" win/loss.
	 */
	involvesPicks: boolean;
}

/** A single waiver / free-agent pickup, used for the steals & busts lists. */
export interface WaiverPickupRow {
	playerId: string;
	playerName: string;
	rosterId: number;
	teamName: string;
	avatar: string | null;
	ownerId: string | null;
	/** FAAB spent on the pickup (0 for a free-agent add). */
	faabBid: number;
	/** Starter points the player scored for this roster from the pickup week on. */
	pointsAfterPickup: number;
	week: number;
	/** Season label — set by the all-time aggregator; undefined for one season. */
	season?: string;
}

export interface TradeAnalyticsResult {
	/** All completed trades, enriched with point-swing data */
	trades: AnalyzedTrade[];
	/** Best trade: the single trade with the highest imbalance score (winner's side) */
	bestTrade: AnalyzedTrade | null;
	/** Worst trade: same logic but for the losing side of the most lopsided deal */
	worstTrade: AnalyzedTrade | null;
	/** Best-value pickups: cheap (often free) adds that scored a lot. */
	waiverSteals: WaiverPickupRow[];
	/** Worst-value pickups: real FAAB spent for little production. */
	waiverBusts: WaiverPickupRow[];
	totalTrades: number;
	totalWaiverTransactions: number;
}

/** Pick the N best-value (steals) and worst-value paid (busts) pickups. */
export function selectStealsAndBusts(
	pickups: WaiverPickupRow[],
	limit = 12,
): { steals: WaiverPickupRow[]; busts: WaiverPickupRow[] } {
	// value = points returned minus FAAB spent. Rewards cheap, productive adds.
	const value = (p: WaiverPickupRow) => p.pointsAfterPickup - p.faabBid;
	const steals = [...pickups].sort((a, b) => value(b) - value(a)).slice(0, limit);
	const busts = pickups
		.filter((p) => p.faabBid > 0 && value(p) < 0) // paid more FAAB than points returned
		.sort((a, b) => value(a) - value(b))
		.slice(0, limit);
	return { steals, busts };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

interface RawMatchupEntry {
	roster_id: number;
	week: number;
	/** starter player IDs for that week */
	starters: string[];
	players_points: Record<string, number>;
}

/**
 * Build a lookup from (playerId, rosterId) → list of { week, pts } for
 * starters only. Used to measure points a player scored after being acquired.
 */
function buildStarterIndex(
	matchupWeeks: Array<Array<{ roster_id: number; starters?: string[]; players_points?: Record<string, number> }>>,
): Map<string, Array<{ week: number; pts: number }>> {
	const idx = new Map<string, Array<{ week: number; pts: number }>>();
	for (let wi = 0; wi < matchupWeeks.length; wi++) {
		const week = wi + 1;
		for (const m of matchupWeeks[wi] ?? []) {
			for (const pid of m.starters ?? []) {
				const key = `${pid}_${m.roster_id}`;
				if (!idx.has(key)) idx.set(key, []);
				idx.get(key)!.push({ week, pts: m.players_points?.[pid] ?? 0 });
			}
		}
	}
	return idx;
}

/**
 * Compute points a roster earned from a player in weeks at or after `fromWeek`.
 */
function pointsAfterWeek(
	starterIdx: Map<string, Array<{ week: number; pts: number }>>,
	playerId: string,
	rosterId: number,
	fromWeek: number,
): number {
	const entries = starterIdx.get(`${playerId}_${rosterId}`) ?? [];
	return entries.filter((e) => e.week >= fromWeek).reduce((s, e) => s + e.pts, 0);
}

// ── Core computation ──────────────────────────────────────────────────────────

/**
 * Compute trade & waiver analytics from raw season data.
 *
 * @param transactions  All completed transactions for the season (trades + waivers + FA)
 * @param matchupWeeks  matchupWeeks[weekIndex] = array of matchup entries for that week (0-indexed)
 * @param rosterInfoMap rosterId → RosterInfo (team name, avatar, ownerId)
 * @param players       SlimPlayer lookup by player_id
 */
export function computeTradeAnalytics(
	transactions: SleeperTransaction[],
	matchupWeeks: Array<Array<{ roster_id: number; starters?: string[]; players_points?: Record<string, number> }>>,
	rosterInfoMap: Map<number, RosterInfo>,
	players: Record<string, SlimPlayer>,
	/**
	 * Epoch ms of the season's draft. Transactions before the draft (e.g.
	 * pre-season dynasty trades) are excluded so they aren't mis-attributed to
	 * week 1 and don't skew the lopsided-trade ranking. Omit to keep everything.
	 */
	draftStartMs?: number,
): TradeAnalyticsResult {
	const starterIdx = buildStarterIndex(matchupWeeks);

	// Drop anything that settled before the draft — nothing legitimate happens
	// before rosters exist, and pre-draft trades otherwise get charged a full
	// season of points at week 1.
	const inSeason =
		draftStartMs === undefined
			? transactions
			: transactions.filter((t) => t.status_updated >= draftStartMs);

	const completedTrades = inSeason.filter(
		(t) => t.type === 'trade' && t.status === 'complete',
	);

	const waiverTxs = inSeason.filter(
		(t) =>
			(t.type === 'waiver' || t.type === 'free_agent') &&
			t.status === 'complete',
	);

	// ── Trade analysis ────────────────────────────────────────────────────────

	const analyzedTrades: AnalyzedTrade[] = completedTrades.map((t) => {
		const week = t.leg ?? 1;

		// Build per-party asset maps
		// adds: playerId → rosterId (who received the player)
		// drops: playerId → rosterId (who gave up the player)
		const adds = t.adds ?? {};
		const drops = t.drops ?? {};

		// All roster IDs involved
		const rosterIds = new Set<number>(t.roster_ids ?? []);

		// For each pick, derive receiver from owner_id and giver from previous_owner_id
		for (const pick of t.draft_picks ?? []) {
			rosterIds.add(pick.owner_id);
			rosterIds.add(pick.previous_owner_id);
		}

		const parties: TradeParty[] = [];
		const pointSwings: Record<number, number> = {};

		for (const rid of rosterIds) {
			const info = rosterInfoMap.get(rid);

			// Players this roster received (added) in this trade
			const received: TradeAsset[] = [];
			for (const [pid, toRid] of Object.entries(adds)) {
				if (toRid !== rid) continue;
				received.push({
					type: 'player',
					label: players[pid]?.name ?? pid,
					playerId: pid,
				});
			}
			// Picks received
			for (const pick of t.draft_picks ?? []) {
				if (pick.owner_id !== rid) continue;
				received.push({
					type: 'pick',
					label: `${pick.season} Round ${pick.round}`,
				});
			}

			// Players this roster gave away (dropped) in this trade
			const gave: TradeAsset[] = [];
			for (const [pid, fromRid] of Object.entries(drops)) {
				if (fromRid !== rid) continue;
				gave.push({
					type: 'player',
					label: players[pid]?.name ?? pid,
					playerId: pid,
				});
			}
			// Picks sent away
			for (const pick of t.draft_picks ?? []) {
				if (pick.previous_owner_id !== rid) continue;
				gave.push({
					type: 'pick',
					label: `${pick.season} Round ${pick.round}`,
				});
			}

			// Net points: points from received players (started, post-trade) minus
			// points from given players (if they had been kept and started)
			let gained = 0;
			for (const asset of received) {
				if (asset.type === 'player' && asset.playerId) {
					gained += pointsAfterWeek(starterIdx, asset.playerId, rid, week);
				}
			}
			let lost = 0;
			for (const asset of gave) {
				if (asset.type === 'player' && asset.playerId) {
					// Points the dropped player scored for the *receiving* roster
					// (i.e., what this party gave up) — the counterfactual
					const toRid = adds[asset.playerId!];
					if (toRid !== undefined) {
						lost += pointsAfterWeek(starterIdx, asset.playerId!, toRid, week);
					}
				}
			}

			pointSwings[rid] = gained - lost;

			parties.push({
				rosterId: rid,
				teamName: info?.teamName ?? `Team ${rid}`,
				avatar: info?.avatar ?? null,
				ownerId: info?.ownerId ?? null,
				received,
				gave,
			});
		}

		const involvesPicks = (t.draft_picks?.length ?? 0) > 0;

		// Imbalance = max swing - min swing (magnitude of the most lopsided outcome)
		const swingValues = Object.values(pointSwings);
		const maxSwing = swingValues.length ? Math.max(...swingValues) : 0;
		const minSwing = swingValues.length ? Math.min(...swingValues) : 0;
		const imbalanceScore = maxSwing - minSwing;

		return {
			transactionId: t.transaction_id,
			date: t.status_updated,
			week,
			parties,
			pointSwings,
			imbalanceScore,
			involvesPicks,
		};
	});

	// Sort trades by date descending (most recent first) for display
	const tradesSorted = [...analyzedTrades].sort((a, b) => b.date - a.date);

	// Most lopsided = the biggest player-for-player imbalance. Pick-involving
	// trades are excluded — a draft pick has value that points can't capture, so
	// giving a player for a pick isn't a "true" point loss.
	const byImbalance = analyzedTrades
		.filter((t) => !t.involvesPicks)
		.sort((a, b) => b.imbalanceScore - a.imbalanceScore);
	const bestTrade = byImbalance[0] ?? null;
	const worstTrade = byImbalance[0] ?? null; // same transaction, different party shown in UI

	// ── Waiver / FAAB pickups ──────────────────────────────────────────────────

	// First acquisition per (player, roster), so points are counted from the
	// pickup onward and a re-add doesn't double-count.
	const firstPickup = new Map<string, { week: number; faab: number }>();
	for (const t of waiverTxs) {
		const week = t.leg ?? 1;
		const bid = t.waiver_budget?.[0]?.amount ?? t.settings?.waiver_bid ?? 0;
		for (const [pid, rid] of Object.entries(t.adds ?? {})) {
			const key = `${pid}_${rid}`;
			if (!firstPickup.has(key)) firstPickup.set(key, { week, faab: bid });
		}
	}

	const pickups: WaiverPickupRow[] = [];
	for (const [key, { week, faab }] of firstPickup) {
		const sep = key.lastIndexOf('_');
		const pid = key.slice(0, sep);
		const rid = Number(key.slice(sep + 1));
		const info = rosterInfoMap.get(rid);
		pickups.push({
			playerId: pid,
			playerName: players[pid]?.name ?? pid,
			rosterId: rid,
			teamName: info?.teamName ?? `Team ${rid}`,
			avatar: info?.avatar ?? null,
			ownerId: info?.ownerId ?? null,
			faabBid: faab,
			pointsAfterPickup: pointsAfterWeek(starterIdx, pid, rid, week),
			week,
		});
	}

	const { steals: waiverSteals, busts: waiverBusts } = selectStealsAndBusts(pickups);

	return {
		trades: tradesSorted,
		bestTrade,
		worstTrade,
		waiverSteals,
		waiverBusts,
		totalTrades: completedTrades.length,
		totalWaiverTransactions: waiverTxs.length,
	};
}

// ── All-time aggregation ───────────────────────────────────────────────────────

/**
 * Combine per-season results into one all-time view.
 *
 * - Trades are concatenated (each tagged with its season) and re-sorted newest-first.
 * - Best/worst trade is the single most lopsided deal across every season.
 * - Steals/busts: merging each season's top-N and re-ranking yields the exact
 *   all-time top-N (an all-time top-N pickup is always top-N within its own
 *   season), so we just pool the per-season lists and re-select.
 *
 * @param perSeason  results paired with their season label, in any order
 */
export function aggregateTradeAnalytics(
	perSeason: Array<{ season: string; result: TradeAnalyticsResult }>,
): TradeAnalyticsResult {
	const allTrades: AnalyzedTrade[] = [];
	const allPickups: WaiverPickupRow[] = [];
	let totalTrades = 0;
	let totalWaiverTransactions = 0;

	const seenPickup = new Set<string>();
	for (const { season, result } of perSeason) {
		totalTrades += result.totalTrades;
		totalWaiverTransactions += result.totalWaiverTransactions;
		for (const t of result.trades) allTrades.push({ ...t, season });
		// A pickup can appear in both a season's steals and busts on tiny datasets;
		// dedupe so it isn't double-counted in the pooled re-ranking.
		for (const p of [...result.waiverSteals, ...result.waiverBusts]) {
			const k = `${season}_${p.playerId}_${p.rosterId}`;
			if (seenPickup.has(k)) continue;
			seenPickup.add(k);
			allPickups.push({ ...p, season });
		}
	}

	const { steals: waiverSteals, busts: waiverBusts } = selectStealsAndBusts(allPickups);

	const tradesSorted = [...allTrades].sort((a, b) => b.date - a.date);
	const byImbalance = allTrades
		.filter((t) => !t.involvesPicks)
		.sort((a, b) => b.imbalanceScore - a.imbalanceScore);
	const bestTrade = byImbalance[0] ?? null;

	return {
		trades: tradesSorted,
		bestTrade,
		worstTrade: bestTrade,
		waiverSteals,
		waiverBusts,
		totalTrades,
		totalWaiverTransactions,
	};
}
