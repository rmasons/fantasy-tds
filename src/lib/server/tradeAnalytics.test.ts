import { describe, it, expect } from 'vitest';
import { computeTradeAnalytics, aggregateTradeAnalytics } from './tradeAnalytics';
import type { SleeperTransaction, SlimPlayer } from '$lib/types';
import type { RosterInfo } from '$lib/sleeper';

// ── Shared fixtures ────────────────────────────────────────────────────────────

const rosterInfoMap = new Map<number, RosterInfo>([
	[1, { teamName: 'Alpha Squad', ownerName: 'Alice', avatar: null, ownerId: 'u1' }],
	[2, { teamName: 'Beta Force', ownerName: 'Bob', avatar: null, ownerId: 'u2' }],
	[3, { teamName: 'Gamma Gang', ownerName: 'Carol', avatar: null, ownerId: 'u3' }],
]);

const players: Record<string, SlimPlayer> = {
	p1: { name: 'Josh Allen', pos: 'QB', team: 'BUF', yearsExp: 5 },
	p2: { name: 'Cooper Kupp', pos: 'WR', team: 'LAR', yearsExp: 6 },
	p3: { name: 'Breece Hall', pos: 'RB', team: 'NYJ', yearsExp: 2 },
	p4: { name: 'Travis Kelce', pos: 'TE', team: 'KC', yearsExp: 10 },
};

/** Build a minimal complete SleeperTransaction for a trade */
function makeTrade(
	opts: {
		id?: string;
		week?: number;
		rosterIds?: number[];
		/** playerId → toRosterId */
		adds?: Record<string, number>;
		/** playerId → fromRosterId */
		drops?: Record<string, number>;
	} = {},
): SleeperTransaction {
	return {
		transaction_id: opts.id ?? 'tx1',
		type: 'trade',
		status: 'complete',
		status_updated: 1_700_000_000_000 + (opts.week ?? 1) * 1000,
		created: 1_700_000_000_000,
		leg: opts.week ?? 1,
		roster_ids: opts.rosterIds ?? [1, 2],
		consenter_ids: null,
		adds: opts.adds ?? null,
		drops: opts.drops ?? null,
		draft_picks: [],
		waiver_budget: [],
		settings: null,
		metadata: null,
		creator: 'u1',
	};
}

/** Build a minimal waiver transaction */
function makeWaiver(
	opts: {
		id?: string;
		week?: number;
		/** playerId → toRosterId */
		adds?: Record<string, number>;
		faabBid?: number;
	} = {},
): SleeperTransaction {
	const bid = opts.faabBid ?? 10;
	const entries = Object.entries(opts.adds ?? {});
	return {
		transaction_id: opts.id ?? 'wv1',
		type: 'waiver',
		status: 'complete',
		status_updated: 1_700_000_000_000 + (opts.week ?? 1) * 1000,
		created: 1_700_000_000_000,
		leg: opts.week ?? 1,
		roster_ids: entries.map(([, rid]) => rid),
		consenter_ids: null,
		adds: opts.adds ?? null,
		drops: null,
		draft_picks: [],
		waiver_budget: entries.map(([, rid]) => ({ sender: 0, receiver: rid, amount: bid })),
		settings: { waiver_bid: bid },
		metadata: null,
		creator: 'u1',
	};
}

/** Build a matchup entry for a specific week */
function matchupEntry(
	rosterId: number,
	week: number,
	starters: string[],
	points: Record<string, number>,
) {
	return { roster_id: rosterId, week, starters, players_points: points };
}

/** Build matchupWeeks array (0-indexed by week-1) */
function buildMatchupWeeks(
	entries: Array<{ roster_id: number; week: number; starters: string[]; players_points: Record<string, number> }>,
	numWeeks: number,
) {
	const weeks: Array<typeof entries> = Array.from({ length: numWeeks }, () => []);
	for (const e of entries) weeks[e.week - 1].push(e);
	return weeks;
}

// ── Tests: edge cases ─────────────────────────────────────────────────────────

describe('computeTradeAnalytics — edge cases', () => {
	it('returns empty result when there are no transactions', () => {
		const result = computeTradeAnalytics([], [], rosterInfoMap, players);
		expect(result.totalTrades).toBe(0);
		expect(result.totalWaiverTransactions).toBe(0);
		expect(result.trades).toHaveLength(0);
		expect(result.bestTrade).toBeNull();
		expect(result.worstTrade).toBeNull();
		expect(result.waiverRoi).toHaveLength(0);
	});

	it('ignores incomplete / pending transactions', () => {
		const pending: SleeperTransaction = { ...makeTrade(), status: 'pending' };
		const failed: SleeperTransaction = { ...makeTrade({ id: 'tx2' }), status: 'failed' };
		const result = computeTradeAnalytics([pending, failed], [], rosterInfoMap, players);
		expect(result.totalTrades).toBe(0);
	});

	it('handles a trade with no player adds/drops (draft-pick-only swap)', () => {
		const trade = makeTrade({ id: 'picks-only', rosterIds: [1, 2] });
		// Inject draft pick data
		trade.draft_picks = [
			{ season: '2025', round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 2 },
			{ season: '2025', round: 3, roster_id: 2, previous_owner_id: 2, owner_id: 1 },
		];

		const result = computeTradeAnalytics([trade], [], rosterInfoMap, players);
		expect(result.totalTrades).toBe(1);
		const t = result.trades[0];
		const party1 = t.parties.find((p) => p.rosterId === 1)!;
		const party2 = t.parties.find((p) => p.rosterId === 2)!;
		expect(party1.received.some((a) => a.label === '2025 Round 3')).toBe(true);
		expect(party2.received.some((a) => a.label === '2025 Round 1')).toBe(true);
	});

	it('handles trades with unknown player IDs gracefully (falls back to ID string)', () => {
		const trade = makeTrade({
			adds: { unknownPid: 1 },
			drops: { unknownPid: 2 },
		});
		const result = computeTradeAnalytics([trade], [], rosterInfoMap, {});
		expect(result.totalTrades).toBe(1);
		const party = result.trades[0].parties.find((p) => p.rosterId === 1)!;
		expect(party.received[0].label).toBe('unknownPid');
	});

	it('handles missing rosterInfoMap entry (falls back to "Team N")', () => {
		const trade = makeTrade({ rosterIds: [99, 2] });
		const result = computeTradeAnalytics([trade], [], rosterInfoMap, players);
		const unknown = result.trades[0].parties.find((p) => p.rosterId === 99)!;
		expect(unknown.teamName).toBe('Team 99');
		expect(unknown.ownerId).toBeNull();
	});
});

// ── Tests: trade analytics ────────────────────────────────────────────────────

describe('computeTradeAnalytics — trade analysis', () => {
	// Roster 1 gives p2 (Kupp) and receives p1 (Allen) in week 2.
	// After the trade:
	//   - Allen scores 35 for roster 1 in weeks 2 & 3.
	//   - Kupp scores 10 for roster 2 in weeks 2 & 3.
	// So roster 1 net = +35 (gained) − 10 (gave away, counted for receiver) = +25
	// Roster 2 net = +10 − 35 = −25

	const trade = makeTrade({
		id: 'tx-swap',
		week: 2,
		rosterIds: [1, 2],
		adds: { p1: 1, p2: 2 }, // roster1 gets Allen, roster2 gets Kupp
		drops: { p1: 2, p2: 1 }, // roster2 dropped Allen, roster1 dropped Kupp
	});

	const matchupWeeks = buildMatchupWeeks(
		[
			// Week 2 (post-trade)
			matchupEntry(1, 2, ['p1'], { p1: 20 }),
			matchupEntry(2, 2, ['p2'], { p2: 5 }),
			// Week 3
			matchupEntry(1, 3, ['p1'], { p1: 15 }),
			matchupEntry(2, 3, ['p2'], { p2: 5 }),
		],
		3,
	);

	it('counts only post-trade starter points', () => {
		const result = computeTradeAnalytics([trade], matchupWeeks, rosterInfoMap, players);
		const t = result.trades[0];
		// Roster 1 gained Allen (35 pts) — Kupp scored 10 for roster 2 after trade
		expect(t.pointSwings[1]).toBeCloseTo(35 - 10, 1);
		// Roster 2 gained Kupp (10 pts) — Allen scored 35 for roster 1 after trade
		expect(t.pointSwings[2]).toBeCloseTo(10 - 35, 1);
	});

	it('computes imbalance as max - min swing', () => {
		const result = computeTradeAnalytics([trade], matchupWeeks, rosterInfoMap, players);
		const t = result.trades[0];
		// (35-10) - (10-35) = 25 - (-25) = 50
		expect(t.imbalanceScore).toBeCloseTo(50, 1);
	});

	it('identifies bestTrade / worstTrade as the most lopsided deal', () => {
		// Add a second, balanced trade for comparison
		const balancedTrade = makeTrade({
			id: 'tx-balanced',
			week: 1,
			rosterIds: [1, 3],
			adds: { p3: 1, p4: 3 },
			drops: { p3: 3, p4: 1 },
		});
		const mw = buildMatchupWeeks(
			[
				matchupEntry(1, 2, ['p1', 'p3'], { p1: 20, p3: 5 }),
				matchupEntry(2, 2, ['p2'], { p2: 5 }),
				matchupEntry(3, 1, ['p4'], { p4: 5 }),
				matchupEntry(1, 3, ['p1'], { p1: 15 }),
				matchupEntry(2, 3, ['p2'], { p2: 5 }),
			],
			3,
		);

		const result = computeTradeAnalytics(
			[trade, balancedTrade],
			mw,
			rosterInfoMap,
			players,
		);

		// The lopsided trade (imbalance 50) should be best/worst
		expect(result.bestTrade?.transactionId).toBe('tx-swap');
		expect(result.worstTrade?.transactionId).toBe('tx-swap');
	});

	it('includes player names in party assets', () => {
		const result = computeTradeAnalytics([trade], matchupWeeks, rosterInfoMap, players);
		const t = result.trades[0];
		const party1 = t.parties.find((p) => p.rosterId === 1)!;
		expect(party1.received.some((a) => a.label === 'Josh Allen')).toBe(true);
		expect(party1.gave.some((a) => a.label === 'Cooper Kupp')).toBe(true);
	});

	it('sorts trades by date descending', () => {
		const older = makeTrade({ id: 'old', week: 1 });
		older.status_updated = 1000;
		const newer = makeTrade({ id: 'new', week: 5 });
		newer.status_updated = 9999;

		const result = computeTradeAnalytics([older, newer], [], rosterInfoMap, players);
		expect(result.trades[0].transactionId).toBe('new');
		expect(result.trades[1].transactionId).toBe('old');
	});

	it('handles zero-point trades (no matchup data) with imbalance = 0', () => {
		const result = computeTradeAnalytics([trade], [], rosterInfoMap, players);
		const t = result.trades[0];
		expect(t.pointSwings[1]).toBe(0);
		expect(t.pointSwings[2]).toBe(0);
		expect(t.imbalanceScore).toBe(0);
	});

	it('counts totalTrades and totalWaiverTransactions correctly', () => {
		const waiver = makeWaiver({ id: 'wv1', week: 3, adds: { p3: 1 }, faabBid: 20 });
		const result = computeTradeAnalytics(
			[trade, waiver],
			matchupWeeks,
			rosterInfoMap,
			players,
		);
		expect(result.totalTrades).toBe(1);
		expect(result.totalWaiverTransactions).toBe(1);
	});
});

// ── Tests: waiver / FAAB ROI ──────────────────────────────────────────────────

describe('computeTradeAnalytics — waiver ROI', () => {
	it('aggregates FAAB spent and post-pickup starter points per roster', () => {
		const waivers: SleeperTransaction[] = [
			makeWaiver({ id: 'wv1', week: 2, adds: { p3: 1 }, faabBid: 30 }),
			makeWaiver({ id: 'wv2', week: 3, adds: { p4: 2 }, faabBid: 15 }),
		];

		const matchupWeeks = buildMatchupWeeks(
			[
				// p3 starts for roster 1 in weeks 2 and 3 (post-pickup from week 2)
				matchupEntry(1, 2, ['p3'], { p3: 25 }),
				matchupEntry(1, 3, ['p3'], { p3: 20 }),
				// p4 starts for roster 2 in week 3 only (post-pickup from week 3)
				matchupEntry(2, 2, ['p4'], { p4: 30 }), // week 2 shouldn't count (not yet acquired)
				matchupEntry(2, 3, ['p4'], { p4: 18 }),
			],
			3,
		);

		const result = computeTradeAnalytics(waivers, matchupWeeks, rosterInfoMap, players);

		const row1 = result.waiverRoi.find((r) => r.rosterId === 1)!;
		expect(row1.faabSpent).toBe(30);
		expect(row1.pointsGained).toBeCloseTo(45, 1); // 25 + 20

		const row2 = result.waiverRoi.find((r) => r.rosterId === 2)!;
		expect(row2.faabSpent).toBe(15);
		expect(row2.pointsGained).toBeCloseTo(18, 1); // only week 3 counts
	});

	it('computes ROI as pointsGained / faabSpent', () => {
		const waivers: SleeperTransaction[] = [
			makeWaiver({ id: 'wv1', week: 1, adds: { p1: 1 }, faabBid: 50 }),
		];
		const matchupWeeks = buildMatchupWeeks(
			[matchupEntry(1, 1, ['p1'], { p1: 100 })],
			1,
		);

		const result = computeTradeAnalytics(waivers, matchupWeeks, rosterInfoMap, players);
		const row = result.waiverRoi.find((r) => r.rosterId === 1)!;
		expect(row.roi).toBeCloseTo(2, 2); // 100 / 50 = 2
	});

	it('returns Infinity ROI when FAAB = 0 (free agent pickup) but points > 0', () => {
		const waivers: SleeperTransaction[] = [
			makeWaiver({ id: 'fa1', week: 1, adds: { p1: 1 }, faabBid: 0 }),
		];
		const matchupWeeks = buildMatchupWeeks(
			[matchupEntry(1, 1, ['p1'], { p1: 20 })],
			1,
		);

		const result = computeTradeAnalytics(waivers, matchupWeeks, rosterInfoMap, players);
		const row = result.waiverRoi.find((r) => r.rosterId === 1)!;
		expect(row.roi).toBe(Infinity);
	});

	it('returns ROI = 0 when both FAAB and points are 0', () => {
		const waivers: SleeperTransaction[] = [
			makeWaiver({ id: 'fa1', week: 1, adds: { p1: 1 }, faabBid: 0 }),
		];
		// No matchup data → 0 points
		const result = computeTradeAnalytics(waivers, [], rosterInfoMap, players);
		const row = result.waiverRoi.find((r) => r.rosterId === 1)!;
		expect(row.roi).toBe(0);
	});

	it('deduplicates pickups — only counts first acquisition of a player per roster', () => {
		// Same player added twice (re-add after dropped) — only count from first pickup
		const waivers: SleeperTransaction[] = [
			makeWaiver({ id: 'wv1', week: 1, adds: { p1: 1 }, faabBid: 20 }),
			makeWaiver({ id: 'wv2', week: 3, adds: { p1: 1 }, faabBid: 10 }), // same player, same roster
		];
		const result = computeTradeAnalytics(waivers, [], rosterInfoMap, players);
		const row = result.waiverRoi.find((r) => r.rosterId === 1)!;
		// Only the first $20 bid should be counted (first pickup wins)
		expect(row.faabSpent).toBe(20);
	});

	it('sorts waiverRoi rows by pointsGained descending', () => {
		const waivers: SleeperTransaction[] = [
			makeWaiver({ id: 'wv1', week: 1, adds: { p2: 2 }, faabBid: 5 }),
			makeWaiver({ id: 'wv2', week: 1, adds: { p1: 1 }, faabBid: 5 }),
		];
		const matchupWeeks = buildMatchupWeeks(
			[
				matchupEntry(1, 1, ['p1'], { p1: 10 }),
				matchupEntry(2, 1, ['p2'], { p2: 40 }),
			],
			1,
		);
		const result = computeTradeAnalytics(waivers, matchupWeeks, rosterInfoMap, players);
		// Roster 2 has more points gained (40 > 10)
		expect(result.waiverRoi[0].rosterId).toBe(2);
	});

	it('includes topPickups with player names and points', () => {
		const waivers: SleeperTransaction[] = [
			makeWaiver({ id: 'wv1', week: 1, adds: { p1: 1 }, faabBid: 20 }),
		];
		const matchupWeeks = buildMatchupWeeks(
			[matchupEntry(1, 1, ['p1'], { p1: 50 })],
			1,
		);
		const result = computeTradeAnalytics(waivers, matchupWeeks, rosterInfoMap, players);
		const row = result.waiverRoi[0];
		expect(row.topPickups[0].playerName).toBe('Josh Allen');
		expect(row.topPickups[0].pointsAfterPickup).toBeCloseTo(50, 1);
		expect(row.topPickups[0].faabBid).toBe(20);
	});

	it('caps topPickups at 5 entries', () => {
		const waivers: SleeperTransaction[] = Array.from({ length: 8 }, (_, i) =>
			makeWaiver({ id: `wv${i}`, week: 1, adds: { [`p${i}`]: 1 }, faabBid: 5 }),
		);
		const result = computeTradeAnalytics(waivers, [], rosterInfoMap, {});
		const row = result.waiverRoi.find((r) => r.rosterId === 1);
		expect(row?.topPickups.length).toBeLessThanOrEqual(5);
	});

	it('handles free_agent type transactions identically to waiver', () => {
		const fa: SleeperTransaction = {
			...makeWaiver({ id: 'fa1', week: 1, adds: { p1: 1 }, faabBid: 0 }),
			type: 'free_agent',
		};
		const result = computeTradeAnalytics([fa], [], rosterInfoMap, players);
		expect(result.totalWaiverTransactions).toBe(1);
		expect(result.waiverRoi).toHaveLength(1);
	});
});

// ── Tests: draft-pick trades excluded from lopsided ranking ────────────────────

describe('computeTradeAnalytics — draft-pick trades', () => {
	function pickForPlayer() {
		// roster 1 sends a productive player, gets a pick back; roster 2 sends a pick.
		const t = makeTrade({ id: 'pick-deal', week: 1, rosterIds: [1, 2], adds: { p1: 2 }, drops: { p1: 1 } });
		t.draft_picks = [{ season: '2025', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 }];
		return t;
	}

	it('flags trades that include draft picks', () => {
		const result = computeTradeAnalytics([pickForPlayer()], [], rosterInfoMap, players);
		expect(result.trades[0].involvesPicks).toBe(true);
	});

	it('excludes pick-involving trades from the most-lopsided ranking', () => {
		// p1 scores big for roster 2 after the deal — a huge raw swing, but it's a
		// pick trade so it must NOT be picked as the most lopsided.
		const mw = buildMatchupWeeks([matchupEntry(2, 2, ['p1'], { p1: 40 })], 3);
		const playerTrade = makeTrade({ id: 'player-deal', week: 1, rosterIds: [1, 3], adds: { p2: 1 }, drops: { p2: 3 } });
		const result = computeTradeAnalytics([pickForPlayer(), playerTrade], mw, rosterInfoMap, players);
		expect(result.bestTrade?.transactionId).toBe('player-deal');
	});

	it('leaves bestTrade null when every trade involves picks', () => {
		const result = computeTradeAnalytics([pickForPlayer()], [], rosterInfoMap, players);
		expect(result.bestTrade).toBeNull();
		expect(result.totalTrades).toBe(1); // still counted
	});
});

// ── Tests: pre-draft cutoff (draftStartMs) ─────────────────────────────────────

describe('computeTradeAnalytics — pre-draft cutoff', () => {
	const DRAFT_MS = 1_700_000_500_000;

	function preDraftTrade() {
		// status_updated well before the draft cutoff
		return { ...makeTrade({ id: 'pre' }), status_updated: DRAFT_MS - 10_000 };
	}
	function inSeasonTrade() {
		return { ...makeTrade({ id: 'in', adds: { p1: 1 }, drops: { p1: 2 } }), status_updated: DRAFT_MS + 10_000 };
	}

	it('keeps all trades when no cutoff is given', () => {
		const result = computeTradeAnalytics([preDraftTrade(), inSeasonTrade()], [], rosterInfoMap, players);
		expect(result.totalTrades).toBe(2);
	});

	it('drops trades that settled before the draft', () => {
		const result = computeTradeAnalytics(
			[preDraftTrade(), inSeasonTrade()],
			[],
			rosterInfoMap,
			players,
			DRAFT_MS,
		);
		expect(result.totalTrades).toBe(1);
		expect(result.trades[0].transactionId).toBe('in');
	});

	it('also excludes pre-draft waiver/FA pickups', () => {
		const preWaiver = { ...makeWaiver({ id: 'wpre', adds: { p2: 1 } }), status_updated: DRAFT_MS - 5_000 };
		const result = computeTradeAnalytics([preWaiver], [], rosterInfoMap, players, DRAFT_MS);
		expect(result.totalWaiverTransactions).toBe(0);
	});
});

// ── Tests: all-time aggregation ────────────────────────────────────────────────

describe('aggregateTradeAnalytics', () => {
	it('returns an empty result for no seasons', () => {
		const agg = aggregateTradeAnalytics([]);
		expect(agg.totalTrades).toBe(0);
		expect(agg.trades).toHaveLength(0);
		expect(agg.bestTrade).toBeNull();
		expect(agg.waiverRoi).toHaveLength(0);
	});

	it('sums totals, tags trades by season, and picks the all-time most lopsided', () => {
		const matchups2024 = buildMatchupWeeks(
			[matchupEntry(1, 2, ['p1'], { p1: 30 }), matchupEntry(2, 2, [], {})],
			3,
		);
		const s2024 = computeTradeAnalytics(
			[makeTrade({ id: 't24', week: 1, adds: { p1: 1 }, drops: { p1: 2 } })],
			matchups2024,
			rosterInfoMap,
			players,
		);
		const s2023 = computeTradeAnalytics(
			[makeTrade({ id: 't23', week: 1, adds: { p2: 1 }, drops: { p2: 2 } })],
			[],
			rosterInfoMap,
			players,
		);

		const agg = aggregateTradeAnalytics([
			{ season: '2023', result: s2023 },
			{ season: '2024', result: s2024 },
		]);

		expect(agg.totalTrades).toBe(2);
		expect(agg.trades).toHaveLength(2);
		// every trade carries its season tag
		expect(new Set(agg.trades.map((t) => t.season))).toEqual(new Set(['2023', '2024']));
		// the 2024 trade has real point swing, so it's the most lopsided all-time
		expect(agg.bestTrade?.transactionId).toBe('t24');
		expect(agg.worstTrade?.transactionId).toBe('t24');
	});

	it('aggregates waiver ROI by owner across seasons', () => {
		const mk = (id: string, pts: number) => {
			const m = buildMatchupWeeks([matchupEntry(1, 1, ['p3'], { p3: pts })], 2);
			return computeTradeAnalytics([makeWaiver({ id, adds: { p3: 1 }, faabBid: 5 })], m, rosterInfoMap, players);
		};
		const agg = aggregateTradeAnalytics([
			{ season: '2023', result: mk('w23', 10) },
			{ season: '2024', result: mk('w24', 20) },
		]);
		// roster 1 → owner u1, combined across both seasons
		const row = agg.waiverRoi.find((r) => r.ownerId === 'u1');
		expect(row).toBeTruthy();
		expect(row!.faabSpent).toBe(10); // 5 + 5
		expect(row!.pointsGained).toBeCloseTo(30); // 10 + 20
		expect(row!.roi).toBeCloseTo(3); // 30 / 10
	});
});
