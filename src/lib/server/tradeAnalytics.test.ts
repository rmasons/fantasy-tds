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
		expect(result.waiverSteals).toHaveLength(0);
		expect(result.waiverBusts).toHaveLength(0);
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

// ── Tests: waiver steals & busts ──────────────────────────────────────────────

describe('computeTradeAnalytics — waiver steals & busts', () => {
	it('counts only starter points from the pickup week onward', () => {
		const waivers: SleeperTransaction[] = [
			makeWaiver({ id: 'wv1', week: 3, adds: { p4: 2 }, faabBid: 15 }),
		];
		const matchupWeeks = buildMatchupWeeks(
			[
				matchupEntry(2, 2, ['p4'], { p4: 30 }), // before pickup — must NOT count
				matchupEntry(2, 3, ['p4'], { p4: 18 }), // from week 3 on — counts
			],
			3,
		);
		const result = computeTradeAnalytics(waivers, matchupWeeks, rosterInfoMap, players);
		const pickup = result.waiverSteals.find((p) => p.rosterId === 2)!;
		expect(pickup.pointsAfterPickup).toBeCloseTo(18, 1);
		expect(pickup.faabBid).toBe(15);
	});

	it('ranks cheap, productive pickups as the biggest steals', () => {
		const waivers: SleeperTransaction[] = [
			makeWaiver({ id: 'free', week: 1, adds: { p1: 1 }, faabBid: 0 }),
			makeWaiver({ id: 'paid', week: 1, adds: { p2: 2 }, faabBid: 40 }),
		];
		const matchupWeeks = buildMatchupWeeks(
			[
				matchupEntry(1, 1, ['p1'], { p1: 60 }), // value 60 - 0 = 60
				matchupEntry(2, 1, ['p2'], { p2: 70 }), // value 70 - 40 = 30
			],
			1,
		);
		const result = computeTradeAnalytics(waivers, matchupWeeks, rosterInfoMap, players);
		// The free $0/60 pickup out-values the $40/70 one.
		expect(result.waiverSteals[0].playerId).toBe('p1');
	});

	it('flags expensive, unproductive paid pickups as busts (and excludes free ones)', () => {
		const waivers: SleeperTransaction[] = [
			makeWaiver({ id: 'bust', week: 1, adds: { p1: 1 }, faabBid: 80 }),
			makeWaiver({ id: 'free', week: 1, adds: { p2: 2 }, faabBid: 0 }),
		];
		const matchupWeeks = buildMatchupWeeks(
			[matchupEntry(1, 1, ['p1'], { p1: 5 })], // $80 for 5 pts → bust
			1,
		);
		const result = computeTradeAnalytics(waivers, matchupWeeks, rosterInfoMap, players);
		expect(result.waiverBusts).toHaveLength(1);
		expect(result.waiverBusts[0].playerId).toBe('p1');
		// A $0 pickup can never be a bust.
		expect(result.waiverBusts.some((p) => p.faabBid === 0)).toBe(false);
	});

	it('deduplicates pickups — only the first acquisition of a player per roster', () => {
		const waivers: SleeperTransaction[] = [
			makeWaiver({ id: 'wv1', week: 1, adds: { p1: 1 }, faabBid: 20 }),
			makeWaiver({ id: 'wv2', week: 3, adds: { p1: 1 }, faabBid: 10 }), // re-add, same roster
		];
		const result = computeTradeAnalytics(waivers, [], rosterInfoMap, players);
		const rows = result.waiverSteals.filter((p) => p.playerId === 'p1' && p.rosterId === 1);
		expect(rows).toHaveLength(1);
		expect(rows[0].faabBid).toBe(20); // first pickup wins
	});

	it('handles free_agent type transactions identically to waiver', () => {
		const fa: SleeperTransaction = {
			...makeWaiver({ id: 'fa1', week: 1, adds: { p1: 1 }, faabBid: 0 }),
			type: 'free_agent',
		};
		const result = computeTradeAnalytics([fa], [], rosterInfoMap, players);
		expect(result.totalWaiverTransactions).toBe(1);
		expect(result.waiverSteals).toHaveLength(1);
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
		expect(agg.waiverSteals).toHaveLength(0);
		expect(agg.waiverBusts).toHaveLength(0);
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

	it('pools waiver pickups across seasons and re-ranks steals, tagged by season', () => {
		const mk = (id: string, pid: string, pts: number) => {
			const m = buildMatchupWeeks([matchupEntry(1, 1, [pid], { [pid]: pts })], 2);
			return computeTradeAnalytics([makeWaiver({ id, adds: { [pid]: 1 }, faabBid: 0 })], m, rosterInfoMap, players);
		};
		const agg = aggregateTradeAnalytics([
			{ season: '2023', result: mk('w23', 'p2', 12) },
			{ season: '2024', result: mk('w24', 'p1', 40) },
		]);
		// Two distinct pickups pooled; the higher-scoring one leads, season tagged.
		expect(agg.waiverSteals).toHaveLength(2);
		expect(agg.waiverSteals[0].playerId).toBe('p1');
		expect(agg.waiverSteals[0].season).toBe('2024');
	});
});
