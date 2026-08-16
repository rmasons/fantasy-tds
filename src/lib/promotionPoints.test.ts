import { describe, it, expect } from 'vitest';
import {
	median,
	pairWeekMatchups,
	computeWeekPP,
	computeSeasonPP,
	sumSeasonPP,
	deriveNeglectAmount,
	rankTier,
	buildPlayInMatchups,
	resolveTierMovements,
	type RawWeekMatchup,
	type TierMap,
	type TierRoster,
} from './promotionPoints';

// ── median ───────────────────────────────────────────────────────────────────

describe('median', () => {
	it('odd-length list → the middle value', () => {
		expect(median([1, 5, 3])).toBe(3);
	});

	it('even-length list → average of the two middle values', () => {
		expect(median([10, 20, 30, 40])).toBe(25);
	});

	it('single value → that value', () => {
		expect(median([42])).toBe(42);
	});

	it('empty list → 0', () => {
		expect(median([])).toBe(0);
	});

	it('unsorted input is sorted before taking the median', () => {
		expect(median([100, 1, 50, 2])).toBe(26); // sorted: 1,2,50,100 → (2+50)/2
	});

	it('12-team league median (even count) can land exactly on a real score', () => {
		// sorted 6th/7th are both 100 → median is exactly 100, matched by a real team
		const scores = [80, 85, 90, 95, 100, 100, 100, 105, 110, 115, 120, 125];
		expect(median(scores)).toBe(100);
	});
});

// ── pairWeekMatchups ─────────────────────────────────────────────────────────

describe('pairWeekMatchups', () => {
	it('pairs two rosters sharing a matchupId into reciprocal rows', () => {
		const raw: RawWeekMatchup[] = [
			{ rosterId: 1, matchupId: 100, points: 120 },
			{ rosterId: 2, matchupId: 100, points: 110 },
		];
		const rows = pairWeekMatchups(1, raw);
		expect(rows).toHaveLength(2);
		expect(rows).toContainEqual({ week: 1, rosterId: 1, points: 120, opponentRosterId: 2, opponentPoints: 110 });
		expect(rows).toContainEqual({ week: 1, rosterId: 2, points: 110, opponentRosterId: 1, opponentPoints: 120 });
	});

	it('drops matchupId groups that are not exactly 2 rosters (bye or glitch)', () => {
		const raw: RawWeekMatchup[] = [
			{ rosterId: 1, matchupId: 100, points: 120 }, // lone bye
			{ rosterId: 2, matchupId: 200, points: 110 },
			{ rosterId: 3, matchupId: 200, points: 90 },
			{ rosterId: 4, matchupId: 200, points: 80 }, // triple glitch
		];
		const rows = pairWeekMatchups(1, raw);
		expect(rows).toHaveLength(0);
	});

	it('handles multiple independent matchups in the same week', () => {
		const raw: RawWeekMatchup[] = [
			{ rosterId: 1, matchupId: 100, points: 120 },
			{ rosterId: 2, matchupId: 100, points: 110 },
			{ rosterId: 3, matchupId: 200, points: 90 },
			{ rosterId: 4, matchupId: 200, points: 95 },
		];
		expect(pairWeekMatchups(3, raw)).toHaveLength(4);
	});
});

// ── computeWeekPP ────────────────────────────────────────────────────────────

/** 12-roster tier map: 3 tiers of 4, rosterIds 1-4 = Tier I, 5-8 = Tier II, 9-12 = Tier III. */
const TIER_MAP: TierMap = {
	1: 1, 2: 1, 3: 1, 4: 1,
	5: 2, 6: 2, 7: 2, 8: 2,
	9: 3, 10: 3, 11: 3, 12: 3,
};

/** Build a full 12-roster week (6 matchups) from a rosterId → points map. */
function fullWeek(week: number, pointsByRoster: Record<number, number>, pairs: Array<[number, number]>): RawWeekMatchup[] {
	const raw: RawWeekMatchup[] = [];
	pairs.forEach(([a, b], i) => {
		raw.push({ rosterId: a, matchupId: i, points: pointsByRoster[a] });
		raw.push({ rosterId: b, matchupId: i, points: pointsByRoster[b] });
	});
	return raw;
}

const STANDARD_PAIRS: Array<[number, number]> = [
	[1, 2], [3, 4],
	[5, 6], [7, 8],
	[9, 10], [11, 12],
];

describe('computeWeekPP — head-to-head win table (by opponent tier, independent of own tier)', () => {
	it('win vs Tier I opponent → +3', () => {
		const pts = { 1: 150, 2: 100, 3: 90, 4: 80, 5: 70, 6: 60, 7: 50, 8: 40, 9: 30, 10: 20, 11: 10, 12: 5 };
		const rows = computeWeekPP(pairWeekMatchups(1, fullWeek(1, pts, STANDARD_PAIRS)), TIER_MAP);
		const r1 = rows.find((r) => r.rosterId === 1)!;
		expect(r1.opponentTier).toBe(1);
		expect(r1.h2h).toBe(3);
	});

	it('win vs Tier II opponent → +2', () => {
		const pts = { 1: 150, 2: 100, 3: 90, 4: 80, 5: 70, 6: 60, 7: 50, 8: 40, 9: 30, 10: 20, 11: 10, 12: 5 };
		const pairs: Array<[number, number]> = [[1, 6], [2, 3], [4, 5], [7, 8], [9, 10], [11, 12]];
		const rows = computeWeekPP(pairWeekMatchups(1, fullWeek(1, pts, pairs)), TIER_MAP);
		const r1 = rows.find((r) => r.rosterId === 1)!;
		expect(r1.opponentTier).toBe(2);
		expect(r1.h2h).toBe(2);
	});

	it('win vs Tier III opponent → +1', () => {
		const pts = { 1: 150, 2: 100, 3: 90, 4: 80, 5: 70, 6: 60, 7: 50, 8: 40, 9: 30, 10: 20, 11: 10, 12: 5 };
		const pairs: Array<[number, number]> = [[1, 9], [2, 3], [4, 5], [6, 7], [8, 10], [11, 12]];
		const rows = computeWeekPP(pairWeekMatchups(1, fullWeek(1, pts, pairs)), TIER_MAP);
		const r1 = rows.find((r) => r.rosterId === 1)!;
		expect(r1.opponentTier).toBe(3);
		expect(r1.h2h).toBe(1);
	});

	it('win PP depends only on opponent tier, not your own tier (Tier III beating Tier I still +3)', () => {
		const pts = { 1: 150, 2: 100, 3: 90, 4: 80, 5: 70, 6: 60, 7: 50, 8: 40, 9: 200, 10: 20, 11: 10, 12: 5 };
		const pairs: Array<[number, number]> = [[9, 1], [2, 3], [4, 5], [6, 7], [8, 10], [11, 12]];
		const rows = computeWeekPP(pairWeekMatchups(1, fullWeek(1, pts, pairs)), TIER_MAP);
		const r9 = rows.find((r) => r.rosterId === 9)!;
		expect(r9.tier).toBe(3);
		expect(r9.opponentTier).toBe(1);
		expect(r9.h2h).toBe(3);
	});
});

describe('computeWeekPP — head-to-head loss table (four cases)', () => {
	it('loss case 1: vs same-tier opponent → -1', () => {
		const pts = { 1: 100, 2: 150, 3: 90, 4: 80, 5: 70, 6: 60, 7: 50, 8: 40, 9: 30, 10: 20, 11: 10, 12: 5 };
		const rows = computeWeekPP(pairWeekMatchups(1, fullWeek(1, pts, STANDARD_PAIRS)), TIER_MAP);
		const r1 = rows.find((r) => r.rosterId === 1)!;
		expect(r1.opponentTier).toBe(1);
		expect(r1.h2h).toBe(-1);
	});

	it('loss case 2: vs lower-tier opponent (Tier I losing to Tier III) → -2', () => {
		const pts = { 1: 100, 2: 30, 3: 90, 4: 80, 5: 70, 6: 60, 7: 50, 8: 40, 9: 200, 10: 20, 11: 10, 12: 5 };
		const pairs: Array<[number, number]> = [[1, 9], [2, 3], [4, 5], [6, 7], [8, 10], [11, 12]];
		const rows = computeWeekPP(pairWeekMatchups(1, fullWeek(1, pts, pairs)), TIER_MAP);
		const r1 = rows.find((r) => r.rosterId === 1)!;
		expect(r1.opponentTier).toBe(3);
		expect(r1.h2h).toBe(-2);
	});

	it('loss case 3: vs lower-tier opponent (Tier II losing to Tier III) → -2', () => {
		const pts = { 1: 100, 2: 30, 3: 90, 4: 80, 5: 70, 6: 60, 7: 50, 8: 40, 9: 200, 10: 20, 11: 10, 12: 5 };
		const pairs: Array<[number, number]> = [[5, 9], [6, 10], [1, 2], [3, 4], [7, 8], [11, 12]];
		const rows = computeWeekPP(pairWeekMatchups(1, fullWeek(1, pts, pairs)), TIER_MAP);
		const r5 = rows.find((r) => r.rosterId === 5)!;
		expect(r5.tier).toBe(2);
		expect(r5.opponentTier).toBe(3);
		expect(r5.h2h).toBe(-2);
	});

	it('loss case 4: vs higher-tier opponent (ruling: losing up is expected) → 0', () => {
		const pts = { 1: 200, 2: 30, 3: 90, 4: 80, 5: 70, 6: 60, 7: 50, 8: 40, 9: 30, 10: 20, 11: 10, 12: 5 };
		const pairs: Array<[number, number]> = [[1, 9], [2, 3], [4, 5], [6, 7], [8, 10], [11, 12]];
		const rows = computeWeekPP(pairWeekMatchups(1, fullWeek(1, pts, pairs)), TIER_MAP);
		const r9 = rows.find((r) => r.rosterId === 9)!;
		expect(r9.tier).toBe(3);
		expect(r9.opponentTier).toBe(1);
		expect(r9.h2h).toBe(0);
	});

	it('a Tier III team losing to a Tier II opponent (still "higher") → 0', () => {
		const pts = { 1: 100, 2: 30, 3: 90, 4: 80, 5: 200, 6: 60, 7: 50, 8: 40, 9: 30, 10: 20, 11: 10, 12: 5 };
		const pairs: Array<[number, number]> = [[5, 9], [1, 2], [3, 4], [6, 7], [8, 10], [11, 12]];
		const rows = computeWeekPP(pairWeekMatchups(1, fullWeek(1, pts, pairs)), TIER_MAP);
		const r9 = rows.find((r) => r.rosterId === 9)!;
		expect(r9.h2h).toBe(0);
	});
});

describe('computeWeekPP — ties (commissioner ruling: 0 PP on all three axes)', () => {
	it('head-to-head tie (equal scores against your opponent) → 0 h2h PP for both, regardless of tier', () => {
		// rosters 1 & 9 tie at 100 — cross-tier tie, still 0.
		const pts = { 1: 100, 2: 30, 3: 90, 4: 80, 5: 70, 6: 60, 7: 50, 8: 40, 9: 100, 10: 20, 11: 10, 12: 5 };
		const pairs: Array<[number, number]> = [[1, 9], [2, 3], [4, 5], [6, 7], [8, 10], [11, 12]];
		const rows = computeWeekPP(pairWeekMatchups(1, fullWeek(1, pts, pairs)), TIER_MAP);
		const r1 = rows.find((r) => r.rosterId === 1)!;
		const r9 = rows.find((r) => r.rosterId === 9)!;
		expect(r1.h2h).toBe(0);
		expect(r9.h2h).toBe(0);
	});

	it('league median tie (score exactly equals the league median) → 0 leagueMedian PP', () => {
		// 12 scores sorted: 80,85,90,95,100,100,100,105,110,115,120,125 → median = (100+100)/2 = 100.
		// Roster scoring exactly 100 ties the median.
		const pts: Record<number, number> = { 1: 80, 2: 85, 3: 90, 4: 95, 5: 100, 6: 100, 7: 100, 8: 105, 9: 110, 10: 115, 11: 120, 12: 125 };
		const rows = computeWeekPP(pairWeekMatchups(1, fullWeek(1, pts, STANDARD_PAIRS)), TIER_MAP);
		for (const rid of [5, 6, 7]) {
			const r = rows.find((row) => row.rosterId === rid)!;
			expect(r.points).toBe(100);
			expect(r.leagueMedian).toBe(0);
		}
	});

	it('tier median tie (score exactly equals the 4-team tier median) → 0 tierMedian PP', () => {
		// Tier I (rosters 1-4) scores: 80, 100, 100, 120 → median = (100+100)/2 = 100.
		// Rosters 2 and 3 score exactly 100 → tie the tier median.
		const pts: Record<number, number> = { 1: 80, 2: 100, 3: 100, 4: 120, 5: 10, 6: 20, 7: 30, 8: 40, 9: 50, 10: 60, 11: 70, 12: 90 };
		const rows = computeWeekPP(pairWeekMatchups(1, fullWeek(1, pts, STANDARD_PAIRS)), TIER_MAP);
		const r2 = rows.find((r) => r.rosterId === 2)!;
		const r3 = rows.find((r) => r.rosterId === 3)!;
		expect(r2.tierMedian).toBe(0);
		expect(r3.tierMedian).toBe(0);
	});
});

describe('computeWeekPP — league and tier median win/loss', () => {
	it('above league median → +1; below → -1', () => {
		const pts: Record<number, number> = { 1: 200, 2: 1, 3: 90, 4: 80, 5: 70, 6: 60, 7: 50, 8: 40, 9: 30, 10: 20, 11: 10, 12: 5 };
		const rows = computeWeekPP(pairWeekMatchups(1, fullWeek(1, pts, STANDARD_PAIRS)), TIER_MAP);
		const leagueMed = median(Object.values(pts));
		const above = rows.find((r) => r.points > leagueMed)!;
		const below = rows.find((r) => r.points < leagueMed)!;
		expect(above.leagueMedian).toBe(1);
		expect(below.leagueMedian).toBe(-1);
	});

	it('above tier median → +2; below → -1', () => {
		const pts: Record<number, number> = { 1: 200, 2: 1, 3: 90, 4: 80, 5: 70, 6: 60, 7: 50, 8: 40, 9: 30, 10: 20, 11: 10, 12: 5 };
		const rows = computeWeekPP(pairWeekMatchups(1, fullWeek(1, pts, STANDARD_PAIRS)), TIER_MAP);
		const r1 = rows.find((r) => r.rosterId === 1)!; // Tier I high scorer
		const r2 = rows.find((r) => r.rosterId === 2)!; // Tier I low scorer
		expect(r1.tierMedian).toBe(2);
		expect(r2.tierMedian).toBe(-1);
	});

	it('total is the sum of h2h + leagueMedian + tierMedian', () => {
		const pts: Record<number, number> = { 1: 200, 2: 1, 3: 90, 4: 80, 5: 70, 6: 60, 7: 50, 8: 40, 9: 30, 10: 20, 11: 10, 12: 5 };
		const rows = computeWeekPP(pairWeekMatchups(1, fullWeek(1, pts, STANDARD_PAIRS)), TIER_MAP);
		for (const r of rows) expect(r.total).toBe(r.h2h + r.leagueMedian + r.tierMedian);
	});
});

describe('computeWeekPP — edge cases', () => {
	it('roster missing from the tier map is skipped entirely', () => {
		const sparseMap: TierMap = { 1: 1, 2: 1 }; // only 1 and 2 known
		const raw: RawWeekMatchup[] = [
			{ rosterId: 1, matchupId: 0, points: 100 },
			{ rosterId: 2, matchupId: 0, points: 90 },
			{ rosterId: 3, matchupId: 1, points: 80 },
			{ rosterId: 4, matchupId: 1, points: 70 },
		];
		const rows = computeWeekPP(pairWeekMatchups(1, raw), sparseMap);
		expect(rows.map((r) => r.rosterId).sort()).toEqual([1, 2]);
	});

	it('empty week → empty result', () => {
		expect(computeWeekPP([], TIER_MAP)).toEqual([]);
	});
});

// ── computeSeasonPP / sumSeasonPP ───────────────────────────────────────────

describe('computeSeasonPP', () => {
	it('walks multiple weeks and sorts by week then rosterId', () => {
		const pts: Record<number, number> = { 1: 200, 2: 1, 3: 90, 4: 80, 5: 70, 6: 60, 7: 50, 8: 40, 9: 30, 10: 20, 11: 10, 12: 5 };
		const weeks = [
			{ week: 2, matchups: fullWeek(2, pts, STANDARD_PAIRS) },
			{ week: 1, matchups: fullWeek(1, pts, STANDARD_PAIRS) },
		];
		const out = computeSeasonPP(weeks, TIER_MAP);
		expect(out[0].week).toBe(1);
		expect(out[out.length - 1].week).toBe(2);
	});
});

describe('sumSeasonPP', () => {
	it('sums a single roster’s weekly totals across the season', () => {
		const pts: Record<number, number> = { 1: 200, 2: 1, 3: 90, 4: 80, 5: 70, 6: 60, 7: 50, 8: 40, 9: 30, 10: 20, 11: 10, 12: 5 };
		const weeks = [
			{ week: 1, matchups: fullWeek(1, pts, STANDARD_PAIRS) },
			{ week: 2, matchups: fullWeek(2, pts, STANDARD_PAIRS) },
		];
		const breakdown = computeSeasonPP(weeks, TIER_MAP);
		const r1Weekly = breakdown.filter((b) => b.rosterId === 1);
		expect(sumSeasonPP(breakdown, 1)).toBe(r1Weekly.reduce((s, b) => s + b.total, 0));
		expect(r1Weekly).toHaveLength(2);
	});
});

// ── deriveNeglectAmount ──────────────────────────────────────────────────────

describe('deriveNeglectAmount', () => {
	it('1st offense (0 prior) → -1', () => expect(deriveNeglectAmount(0)).toBe(-1));
	it('2nd offense (1 prior) → -3', () => expect(deriveNeglectAmount(1)).toBe(-3));
	it('3rd offense (2 prior) → -5', () => expect(deriveNeglectAmount(2)).toBe(-5));
	it('4th offense (3 prior) → -10', () => expect(deriveNeglectAmount(3)).toBe(-10));
	it('5th+ offense stays at -10 (subsequent)', () => expect(deriveNeglectAmount(4)).toBe(-10));
	it('negative prior count treated as 0 (defensive)', () => expect(deriveNeglectAmount(-1)).toBe(-1));
});

// ── rankTier ─────────────────────────────────────────────────────────────────

describe('rankTier', () => {
	it('sorts by totalPP descending', () => {
		const rosters: TierRoster[] = [
			{ rosterId: 1, tier: 1, totalPP: 5, pointsFor: 100 },
			{ rosterId: 2, tier: 1, totalPP: 15, pointsFor: 100 },
			{ rosterId: 3, tier: 1, totalPP: 10, pointsFor: 100 },
		];
		expect(rankTier(rosters).map((r) => r.rosterId)).toEqual([2, 3, 1]);
	});

	it('breaks a PP tie with Points For', () => {
		const rosters: TierRoster[] = [
			{ rosterId: 1, tier: 1, totalPP: 10, pointsFor: 900 },
			{ rosterId: 2, tier: 1, totalPP: 10, pointsFor: 1100 },
		];
		expect(rankTier(rosters).map((r) => r.rosterId)).toEqual([2, 1]);
	});
});

// ── buildPlayInMatchups ──────────────────────────────────────────────────────

function tierStandings(): TierRoster[] {
	return [
		// Tier I: 1 (1st) .. 4 (last)
		{ rosterId: 1, tier: 1, totalPP: 40, pointsFor: 1000 },
		{ rosterId: 2, tier: 1, totalPP: 30, pointsFor: 1000 },
		{ rosterId: 3, tier: 1, totalPP: 20, pointsFor: 1000 },
		{ rosterId: 4, tier: 1, totalPP: 10, pointsFor: 1000 },
		// Tier II: 5 (1st) .. 8 (last)
		{ rosterId: 5, tier: 2, totalPP: 25, pointsFor: 1000 },
		{ rosterId: 6, tier: 2, totalPP: 15, pointsFor: 1000 },
		{ rosterId: 7, tier: 2, totalPP: 5, pointsFor: 1000 },
		{ rosterId: 8, tier: 2, totalPP: -5, pointsFor: 1000 },
		// Tier III: 9 (1st) .. 12 (last)
		{ rosterId: 9, tier: 3, totalPP: 12, pointsFor: 1000 },
		{ rosterId: 10, tier: 3, totalPP: 8, pointsFor: 1000 },
		{ rosterId: 11, tier: 3, totalPP: -2, pointsFor: 1000 },
		{ rosterId: 12, tier: 3, totalPP: -8, pointsFor: 1000 },
	];
}

describe('buildPlayInMatchups', () => {
	it('pairs the lower tier’s top 2 against the upper tier’s bottom 2 (best challenger vs worst incumbent)', () => {
		const matchups = buildPlayInMatchups(tierStandings());
		const bracket1v2 = matchups.filter((m) => m.upperTier === 1 && m.lowerTier === 2);
		expect(bracket1v2).toHaveLength(2);
		const seed1 = bracket1v2.find((m) => m.challengerSeed === 1)!;
		expect(seed1.challenger.rosterId).toBe(5); // Tier II #1
		expect(seed1.incumbent.rosterId).toBe(4); // Tier I last place
		const seed2 = bracket1v2.find((m) => m.challengerSeed === 2)!;
		expect(seed2.challenger.rosterId).toBe(6); // Tier II #2
		expect(seed2.incumbent.rosterId).toBe(3); // Tier I 3rd place
	});

	it('also builds the Tier III vs Tier II bracket', () => {
		const matchups = buildPlayInMatchups(tierStandings());
		const bracket2v3 = matchups.filter((m) => m.upperTier === 2 && m.lowerTier === 3);
		expect(bracket2v3).toHaveLength(2);
		expect(bracket2v3.find((m) => m.challengerSeed === 1)!.challenger.rosterId).toBe(9);
	});

	it('without week17Points, every matchup is undecided (TBD)', () => {
		const matchups = buildPlayInMatchups(tierStandings());
		expect(matchups.every((m) => m.winnerRosterId === null)).toBe(true);
	});

	it('with week17Points, the higher score wins', () => {
		const week17 = new Map<number, number>([
			[5, 150], [4, 100], // challenger (5) beats incumbent (4)
			[6, 90], [3, 110], // incumbent (3) beats challenger (6)
		]);
		const matchups = buildPlayInMatchups(tierStandings(), week17);
		const m1 = matchups.find((m) => m.challenger.rosterId === 5)!;
		const m2 = matchups.find((m) => m.challenger.rosterId === 6)!;
		expect(m1.winnerRosterId).toBe(5);
		expect(m2.winnerRosterId).toBe(3);
	});

	it('a tied week-17 score defends the incumbent (does not promote the challenger)', () => {
		const week17 = new Map<number, number>([[5, 100], [4, 100]]);
		const matchups = buildPlayInMatchups(tierStandings(), week17);
		const m1 = matchups.find((m) => m.challenger.rosterId === 5)!;
		expect(m1.winnerRosterId).toBe(4);
	});

	it('missing week-17 points for either side leaves the matchup undecided', () => {
		const week17 = new Map<number, number>([[5, 100]]); // incumbent's score missing
		const matchups = buildPlayInMatchups(tierStandings(), week17);
		const m1 = matchups.find((m) => m.challenger.rosterId === 5)!;
		expect(m1.winnerRosterId).toBeNull();
	});
});

// ── resolveTierMovements ─────────────────────────────────────────────────────

describe('resolveTierMovements', () => {
	it('a decided play-in promotion moves the challenger up and the incumbent down', () => {
		const standings = tierStandings();
		const playIns = buildPlayInMatchups(standings, new Map([[5, 150], [4, 100]]));
		const movements = resolveTierMovements(standings, playIns);
		const m5 = movements.find((m) => m.rosterId === 5)!;
		const m4 = movements.find((m) => m.rosterId === 4)!;
		expect(m5).toMatchObject({ fromTier: 2, toTier: 1, reason: 'play-in-promotion' });
		expect(m4).toMatchObject({ fromTier: 1, toTier: 2, reason: 'play-in-relegation' });
	});

	it('an incumbent win means both stay put', () => {
		const standings = tierStandings();
		const playIns = buildPlayInMatchups(standings, new Map([[5, 50], [4, 100]]));
		const movements = resolveTierMovements(standings, playIns);
		expect(movements.find((m) => m.rosterId === 5)).toMatchObject({ fromTier: 2, toTier: 2, reason: 'stay' });
		expect(movements.find((m) => m.rosterId === 4)).toMatchObject({ fromTier: 1, toTier: 1, reason: 'stay' });
	});

	it('undecided play-ins move nobody (independent of auto-relegation, which is unaffected by play-in state)', () => {
		// No sub-zero rosters here, so the only possible movements would come from
		// decided play-ins — and with none decided, nothing should move.
		const standings: TierRoster[] = [
			{ rosterId: 1, tier: 1, totalPP: 40, pointsFor: 1000 },
			{ rosterId: 2, tier: 1, totalPP: 30, pointsFor: 1000 },
			{ rosterId: 3, tier: 1, totalPP: 20, pointsFor: 1000 },
			{ rosterId: 4, tier: 1, totalPP: 10, pointsFor: 1000 },
			{ rosterId: 5, tier: 2, totalPP: 25, pointsFor: 1000 },
			{ rosterId: 6, tier: 2, totalPP: 15, pointsFor: 1000 },
			{ rosterId: 7, tier: 2, totalPP: 5, pointsFor: 1000 },
			{ rosterId: 8, tier: 2, totalPP: 3, pointsFor: 1000 },
			{ rosterId: 9, tier: 3, totalPP: 12, pointsFor: 1000 },
			{ rosterId: 10, tier: 3, totalPP: 8, pointsFor: 1000 },
			{ rosterId: 11, tier: 3, totalPP: 4, pointsFor: 1000 },
			{ rosterId: 12, tier: 3, totalPP: 2, pointsFor: 1000 },
		];
		const playIns = buildPlayInMatchups(standings); // no week17Points → all undecided
		const movements = resolveTierMovements(standings, playIns);
		expect(movements.every((m) => m.reason === 'stay')).toBe(true);
	});

	it('sub-zero auto-relegation still applies even while play-ins are undecided', () => {
		const standings = tierStandings(); // includes sub-zero rosters 8, 11, 12
		const playIns = buildPlayInMatchups(standings); // no week17Points → all undecided
		const movements = resolveTierMovements(standings, playIns);
		expect(movements.find((m) => m.rosterId === 8)).toMatchObject({ reason: 'auto-relegation' });
		expect(movements.find((m) => m.rosterId === 11)).toMatchObject({ reason: 'sub-zero-floor' });
	});

	it('a sub-zero Tier II finish auto-relegates and is replaced by the top Tier III roster', () => {
		const standings = tierStandings(); // roster 8 (Tier II) is -5 PP
		const movements = resolveTierMovements(standings, []); // no play-ins in play
		const m8 = movements.find((m) => m.rosterId === 8)!;
		const m9 = movements.find((m) => m.rosterId === 9)!; // Tier III's top PP roster
		expect(m8).toMatchObject({ fromTier: 2, toTier: 3, reason: 'auto-relegation' });
		expect(m9).toMatchObject({ fromTier: 3, toTier: 2, reason: 'auto-promotion' });
	});

	it('a sub-zero Tier III finish has nowhere to drop → sub-zero-floor warning, no movement', () => {
		const standings = tierStandings(); // rosters 11 and 12 (Tier III) are sub-zero
		const movements = resolveTierMovements(standings, []);
		const m11 = movements.find((m) => m.rosterId === 11)!;
		const m12 = movements.find((m) => m.rosterId === 12)!;
		expect(m11).toMatchObject({ fromTier: 3, toTier: 3, reason: 'sub-zero-floor' });
		expect(m12).toMatchObject({ fromTier: 3, toTier: 3, reason: 'sub-zero-floor' });
	});

	it('a roster already relegated via a lost play-in is skipped as an auto-promotion replacement candidate', () => {
		// Tier I: r1 safe; r2 sub-zero (but NOT one of Tier I's own bottom-2, so its relegation
		// is a standalone auto-relegation, independent of the 1v2 play-in); r3/r4 are Tier I's
		// bottom-2 and the 1v2 play-in incumbents.
		const standings: TierRoster[] = [
			{ rosterId: 1, tier: 1, totalPP: 100, pointsFor: 1000 },
			{ rosterId: 2, tier: 1, totalPP: -5, pointsFor: 1000 }, // sub-zero, needs a Tier II replacement
			{ rosterId: 3, tier: 1, totalPP: -10, pointsFor: 1000 }, // 1v2 incumbent seed 3
			{ rosterId: 4, tier: 1, totalPP: -20, pointsFor: 1000 }, // 1v2 incumbent seed 4
			{ rosterId: 5, tier: 2, totalPP: 50, pointsFor: 1000 }, // 1v2 challenger seed 1 → wins, promoted to Tier I
			{ rosterId: 6, tier: 2, totalPP: 40, pointsFor: 1000 }, // 1v2 challenger seed 2 → wins, promoted to Tier I
			{ rosterId: 7, tier: 2, totalPP: 30, pointsFor: 1000 }, // 2v3 incumbent seed 3 → LOSES, relegated to Tier III
			{ rosterId: 8, tier: 2, totalPP: 20, pointsFor: 1000 }, // 2v3 incumbent seed 4 → defends, stays Tier II
			{ rosterId: 9, tier: 3, totalPP: 15, pointsFor: 1000 }, // 2v3 challenger seed 1 → wins, promoted to Tier II
			{ rosterId: 10, tier: 3, totalPP: 10, pointsFor: 1000 }, // 2v3 challenger seed 2 → loses
			{ rosterId: 11, tier: 3, totalPP: 5, pointsFor: 1000 },
			{ rosterId: 12, tier: 3, totalPP: 1, pointsFor: 1000 },
		];

		// Both tier1/2 challengers (5, 6) win → promoted; incumbents (3, 4) relegated to Tier II.
		// In the 2v3 bracket the seeding is best-challenger-vs-worst-incumbent: challenger 9 (Tier
		// III #1) draws incumbent 8 (Tier II #4/last); challenger 10 (Tier III #2) draws incumbent
		// 7 (Tier II #3). Challenger 10 beats incumbent 7 (7 relegated to Tier III); incumbent 8
		// defends against challenger 9 (8 stays Tier II).
		const week17 = new Map<number, number>([
			[5, 200], [4, 10], // 5 beats 4
			[6, 190], [3, 10], // 6 beats 3
			[10, 200], [7, 10], // 10 beats 7 → 7 relegated
			[9, 5], [8, 100], // 8 defends over 9
		]);
		const playIns = buildPlayInMatchups(standings, week17);
		const movements = resolveTierMovements(standings, playIns);

		// After the play-ins, the only Tier-II-tagged roster NOT already moved is roster 8 (it
		// defended and stayed). Roster 7 has a *higher* pre-movement totalPP (30 > 20) and would
		// be picked first by a naive PP-only sort — but it already lost a play-in and is relegated
		// to Tier III, so it must be skipped. Roster 8 is the correct replacement for r2's slot.
		expect(movements.find((m) => m.rosterId === 7)).toMatchObject({ reason: 'play-in-relegation', toTier: 3 });
		expect(movements.find((m) => m.rosterId === 8)).toMatchObject({ reason: 'auto-promotion', fromTier: 2, toTier: 1 });
		expect(movements.find((m) => m.rosterId === 2)).toMatchObject({ reason: 'auto-relegation', fromTier: 1, toTier: 2 });
	});

	it('multiple sub-zero rosters in the same tier each get a distinct replacement (no double-claiming)', () => {
		const standings: TierRoster[] = [
			{ rosterId: 1, tier: 1, totalPP: 40, pointsFor: 1000 },
			{ rosterId: 2, tier: 1, totalPP: -5, pointsFor: 1000 },
			{ rosterId: 3, tier: 1, totalPP: -10, pointsFor: 1000 },
			{ rosterId: 4, tier: 1, totalPP: 10, pointsFor: 1000 },
			{ rosterId: 5, tier: 2, totalPP: 25, pointsFor: 1000 },
			{ rosterId: 6, tier: 2, totalPP: 15, pointsFor: 1000 },
			{ rosterId: 7, tier: 2, totalPP: 5, pointsFor: 1000 },
			{ rosterId: 8, tier: 2, totalPP: -5, pointsFor: 1000 },
		];
		const movements = resolveTierMovements(standings, []);
		const promoted = movements.filter((m) => m.reason === 'auto-promotion').map((m) => m.rosterId);
		expect(promoted.sort()).toEqual([5, 6]); // top two Tier II rosters, not the same one twice
	});

	it('replacement pool exhaustion leaves the relegation unmatched rather than throwing', () => {
		const standings: TierRoster[] = [
			{ rosterId: 1, tier: 1, totalPP: -1, pointsFor: 1000 },
			{ rosterId: 2, tier: 1, totalPP: -2, pointsFor: 1000 },
			{ rosterId: 3, tier: 1, totalPP: -3, pointsFor: 1000 },
			{ rosterId: 4, tier: 1, totalPP: -4, pointsFor: 1000 },
			{ rosterId: 5, tier: 2, totalPP: -5, pointsFor: 1000 }, // Tier II also all sub-zero: no eligible promotion candidates
		];
		const movements = resolveTierMovements(standings, []);
		// Only one Tier II candidate exists; it fills roster 1's slot, and the remaining
		// three sub-zero Tier I rosters relegate with no replacement rather than crashing.
		expect(movements.find((m) => m.rosterId === 1)).toMatchObject({ reason: 'auto-relegation', toTier: 2 });
		expect(movements.find((m) => m.rosterId === 2)).toMatchObject({ reason: 'auto-relegation', toTier: 2 });
		expect(movements.find((m) => m.rosterId === 5)).toMatchObject({ reason: 'auto-promotion', toTier: 1 });
	});
});
