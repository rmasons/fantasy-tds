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
	parties: TradeParty[];
	/** Net roster-points gained by each party after the trade (post-trade starts) */
	pointSwings: Record<number, number>; // rosterId → net points gained
	/** Numeric margin separating the biggest winner from runner-up, in points */
	imbalanceScore: number;
}

export interface WaiverRoiRow {
	rosterId: number;
	teamName: string;
	avatar: string | null;
	ownerId: string | null;
	faabSpent: number;
	pointsGained: number;
	/** pointsGained / faabSpent (Infinity when faabSpent = 0 but points > 0) */
	roi: number;
	/** Players added off waivers with their individual ROI */
	topPickups: WaiverPickup[];
}

export interface WaiverPickup {
	playerId: string;
	playerName: string;
	faabBid: number;
	pointsAfterPickup: number;
}

export interface TradeAnalyticsResult {
	/** All completed trades, enriched with point-swing data */
	trades: AnalyzedTrade[];
	/** Best trade: the single trade with the highest imbalance score (winner's side) */
	bestTrade: AnalyzedTrade | null;
	/** Worst trade: same logic but for the losing side of the most lopsided deal */
	worstTrade: AnalyzedTrade | null;
	/** FAAB / waiver-ROI rows sorted by pointsGained desc */
	waiverRoi: WaiverRoiRow[];
	totalTrades: number;
	totalWaiverTransactions: number;
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
): TradeAnalyticsResult {
	const starterIdx = buildStarterIndex(matchupWeeks);

	const completedTrades = transactions.filter(
		(t) => t.type === 'trade' && t.status === 'complete',
	);

	const waiverTxs = transactions.filter(
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
		};
	});

	// Sort trades by date descending (most recent first) for display
	const tradesSorted = [...analyzedTrades].sort((a, b) => b.date - a.date);

	// Best trade = most lopsided (winner's perspective); worst = loser's same deal
	const byImbalance = [...analyzedTrades].sort((a, b) => b.imbalanceScore - a.imbalanceScore);
	const bestTrade = byImbalance[0] ?? null;
	const worstTrade = byImbalance[0] ?? null; // same transaction, different party shown in UI

	// ── Waiver / FAAB ROI ─────────────────────────────────────────────────────

	// Track first acquisition week per (player, roster) so we only count
	// points earned after the pickup.
	const firstPickup = new Map<string, { week: number; faab: number }>();
	for (const t of waiverTxs) {
		const week = t.leg ?? 1;
		const bid = t.waiver_budget?.[0]?.amount ?? t.settings?.waiver_bid ?? 0;
		for (const [pid, rid] of Object.entries(t.adds ?? {})) {
			const key = `${pid}_${rid}`;
			if (!firstPickup.has(key)) firstPickup.set(key, { week, faab: bid });
		}
	}

	// Aggregate per roster
	const roiByRoster = new Map<
		number,
		{ faabSpent: number; pointsGained: number; pickups: WaiverPickup[] }
	>();

	for (const [key, { week, faab }] of firstPickup) {
		const [pidStr, ridStr] = key.split('_');
		const pid = pidStr;
		const rid = Number(ridStr);
		const pts = pointsAfterWeek(starterIdx, pid, rid, week);

		const cur = roiByRoster.get(rid) ?? { faabSpent: 0, pointsGained: 0, pickups: [] };
		cur.faabSpent += faab;
		cur.pointsGained += pts;
		cur.pickups.push({
			playerId: pid,
			playerName: players[pid]?.name ?? pid,
			faabBid: faab,
			pointsAfterPickup: pts,
		});
		roiByRoster.set(rid, cur);
	}

	const waiverRoi: WaiverRoiRow[] = [...roiByRoster.entries()].map(
		([rid, { faabSpent, pointsGained, pickups }]) => {
			const info = rosterInfoMap.get(rid);
			// Sort top pickups by points desc, keep top 5
			const topPickups = [...pickups]
				.sort((a, b) => b.pointsAfterPickup - a.pointsAfterPickup)
				.slice(0, 5);
			return {
				rosterId: rid,
				teamName: info?.teamName ?? `Team ${rid}`,
				avatar: info?.avatar ?? null,
				ownerId: info?.ownerId ?? null,
				faabSpent,
				pointsGained,
				roi: faabSpent > 0 ? pointsGained / faabSpent : pointsGained > 0 ? Infinity : 0,
				topPickups,
			};
		},
	);

	// Sort by pointsGained desc
	waiverRoi.sort((a, b) => b.pointsGained - a.pointsGained);

	return {
		trades: tradesSorted,
		bestTrade,
		worstTrade,
		waiverRoi,
		totalTrades: completedTrades.length,
		totalWaiverTransactions: waiverTxs.length,
	};
}
