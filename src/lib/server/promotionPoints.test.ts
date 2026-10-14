import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setCacheBackend, type CacheBackend, type CacheEnvelope } from '$lib/server/cache';
import type { RawMatchup } from '$lib/sleeper';
import type { SleeperLeague, SleeperRoster } from '$lib/types';
import type { LeagueConfig, PremierConfig } from '$lib/server/config';

// These three are the only IO seams buildSeasonMatchupPP/getTierProjection touch
// (besides $lib/firebase/admin, which is never invoked on these code paths — no
// ledger writes happen in any test below).
vi.mock('$lib/sleeper', () => ({
	fetchLeagueCore: vi.fn(),
	fetchMatchups: vi.fn(),
}));
vi.mock('$lib/server/sleeperCache', () => ({
	getCachedMatchups: vi.fn(),
}));
vi.mock('$lib/server/config', () => ({
	getLeagueConfig: vi.fn(),
	setLeagueConfig: vi.fn(),
	leagueConfigKey: vi.fn((id: string) => `leagueConfigCache:${id}`),
}));

import { fetchLeagueCore, fetchMatchups } from '$lib/sleeper';
import { getCachedMatchups } from '$lib/server/sleeperCache';
import { getLeagueConfig } from '$lib/server/config';
import {
	getSeasonPromotionPoints,
	getTierProjection,
	hasPlayInWeekBeenPlayed,
	clampRegularSeasonEndWeek,
	setSeasonTiers,
	DEFAULT_REGULAR_SEASON_END_WEEK,
	MAX_REGULAR_SEASON_END_WEEK,
	PLAY_IN_WEEK,
} from './promotionPoints';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const LEAGUE_ID = 'L1';
const SEASON = '2025';

function roster(id: number): SleeperRoster {
	return {
		roster_id: id,
		owner_id: `u${id}`,
		co_owners: null,
		players: null,
		starters: null,
		reserve: null,
		settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, fpts_against: 0, fpts_against_decimal: 0 },
	};
}

// 12 rosters, 3 tiers of 4 — same shape as the pure-engine fixtures.
const ALL_ROSTER_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const TIERS_2025: Record<string, 1 | 2 | 3> = {
	'1': 1, '2': 1, '3': 1, '4': 1,
	'5': 2, '6': 2, '7': 2, '8': 2,
	'9': 3, '10': 3, '11': 3, '12': 3,
};

function baseLeague(overrides: Partial<SleeperLeague> = {}): SleeperLeague {
	return {
		league_id: LEAGUE_ID,
		name: 'Test League',
		season: SEASON,
		season_type: 'regular',
		sport: 'nfl',
		status: 'in_season',
		total_rosters: 12,
		previous_league_id: null,
		settings: { type: 0 },
		avatar: null,
		...overrides,
	};
}

function baseConfig(premierOverrides: Partial<PremierConfig> = {}): LeagueConfig {
	return {
		ruleset: 'premier',
		premier: {
			tiersBySeason: { [SEASON]: TIERS_2025 },
			auctionBudget: { 1: 300, 2: 200, 3: 100 },
			faabBudget: { 1: 300, 2: 200, 3: 100 },
			tradeBudgetCap: { 1: 200, 2: 100, 3: 100 },
			// Small on purpose — keeps each test's week fixtures short.
			regularSeasonEndWeek: 2,
			promotionTransactions: [],
			promotionAdjustments: {},
			...premierOverrides,
		},
	};
}

function matchup(rosterId: number, matchupId: number, points: number): RawMatchup {
	return { roster_id: rosterId, matchup_id: matchupId, points, starters: [] };
}

const STANDARD_PAIRS: Array<[number, number]> = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12]];
const WEEK_POINTS: Record<number, number> = { 1: 150, 2: 100, 3: 90, 4: 80, 5: 70, 6: 60, 7: 50, 8: 40, 9: 30, 10: 20, 11: 10, 12: 5 };

function fullWeek(pointsByRoster: Record<number, number>, pairs: Array<[number, number]>): RawMatchup[] {
	const out: RawMatchup[] = [];
	pairs.forEach(([a, b], i) => {
		out.push(matchup(a, i, pointsByRoster[a]));
		out.push(matchup(b, i, pointsByRoster[b]));
	});
	return out;
}

// ── Cache backend (in-memory fake, same idiom as cache.test.ts) ────────────────

function fakeBackend(): { backend: CacheBackend; store: Map<string, CacheEnvelope<unknown>> } {
	const store = new Map<string, CacheEnvelope<unknown>>();
	const backend = {
		get: vi.fn(async (key: string) => store.get(key) ?? null),
		set: vi.fn(async (key: string, env: CacheEnvelope<unknown>) => {
			store.set(key, env);
		}),
		del: vi.fn(async (key: string) => {
			store.delete(key);
		}),
	} as unknown as CacheBackend;
	return { backend, store };
}

let backend: CacheBackend;

beforeEach(() => {
	({ backend } = fakeBackend());
	setCacheBackend(backend);
	vi.mocked(fetchLeagueCore).mockReset();
	vi.mocked(fetchMatchups).mockReset();
	vi.mocked(getCachedMatchups).mockReset();
	vi.mocked(getLeagueConfig).mockReset();
});

afterEach(() => {
	setCacheBackend(null);
	vi.restoreAllMocks();
});

// ── Bug 1: hasPlayInWeekBeenPlayed (pure) ───────────────────────────────────────

describe('hasPlayInWeekBeenPlayed', () => {
	it('a complete season is always played, regardless of leg fields', () => {
		expect(hasPlayInWeekBeenPlayed('complete', undefined, undefined, 17)).toBe(true);
	});

	it('in-progress season, last_scored_leg before the play-in week → not played', () => {
		expect(hasPlayInWeekBeenPlayed('in_season', 10, undefined, 17)).toBe(false);
	});

	it('in-progress season, last_scored_leg at/after the play-in week → played', () => {
		expect(hasPlayInWeekBeenPlayed('in_season', 17, undefined, 17)).toBe(true);
		expect(hasPlayInWeekBeenPlayed('in_season', 18, undefined, 17)).toBe(true);
	});

	it('falls back to leg when last_scored_leg is absent — only trusts it strictly past the play-in week', () => {
		// leg === playInWeek could still be mid-scoring that very week.
		expect(hasPlayInWeekBeenPlayed('in_season', undefined, 17, 17)).toBe(false);
		expect(hasPlayInWeekBeenPlayed('in_season', undefined, 18, 17)).toBe(true);
	});

	it('no progress signals at all → not played (defensive)', () => {
		expect(hasPlayInWeekBeenPlayed('in_season', undefined, undefined, 17)).toBe(false);
	});
});

// ── Bug 1: getTierProjection play-in resolution ─────────────────────────────────

describe('getTierProjection — play-in resolution (Bug 1)', () => {
	it('mid-season (play-in week not reached) yields TBD play-ins even though Sleeper returns real non-zero Week 17 scores', async () => {
		// This is the exact shape verified live against Sleeper: every roster
		// scored, matchup_id null, points real and non-zero — for a week that
		// has NOT actually been played. Map size alone can't catch this.
		vi.mocked(fetchLeagueCore).mockResolvedValue({
			league: baseLeague({ status: 'in_season', settings: { type: 0, leg: 10, last_scored_leg: 9 } }),
			rosters: ALL_ROSTER_IDS.map(roster),
			users: [],
		});
		vi.mocked(getLeagueConfig).mockResolvedValue(baseConfig());
		vi.mocked(fetchMatchups).mockImplementation(async (_leagueId: string, week: number) => {
			if (week === 1 || week === 2) return fullWeek(WEEK_POINTS, STANDARD_PAIRS);
			if (week === PLAY_IN_WEEK) return ALL_ROSTER_IDS.map((id) => matchup(id, 0, 98.94));
			return [];
		});

		const projection = await getTierProjection(LEAGUE_ID);
		expect(projection.playIns.length).toBeGreaterThan(0);
		expect(projection.playIns.every((m) => m.winnerRosterId === null)).toBe(true);
	});

	it('a completed season resolves play-in winners from real Week 17 scores', async () => {
		vi.mocked(fetchLeagueCore).mockResolvedValue({
			league: baseLeague({ status: 'complete', settings: { type: 0 } }),
			rosters: ALL_ROSTER_IDS.map(roster),
			users: [],
		});
		vi.mocked(getLeagueConfig).mockResolvedValue(baseConfig());
		vi.mocked(getCachedMatchups).mockImplementation(async (_leagueId: string, week: number) => {
			if (week === 1 || week === 2) return fullWeek(WEEK_POINTS, STANDARD_PAIRS);
			if (week === PLAY_IN_WEEK) return ALL_ROSTER_IDS.map((id) => matchup(id, 0, id === 5 ? 200 : id === 4 ? 50 : 10));
			return [];
		});

		const projection = await getTierProjection(LEAGUE_ID);
		const decided = projection.playIns.filter((m) => m.winnerRosterId !== null);
		expect(decided.length).toBeGreaterThan(0);
	});

	it('defensive backstop: even once progress signals say the week happened, an all-zero score map stays TBD', async () => {
		vi.mocked(fetchLeagueCore).mockResolvedValue({
			league: baseLeague({ status: 'complete', settings: { type: 0 } }),
			rosters: ALL_ROSTER_IDS.map(roster),
			users: [],
		});
		vi.mocked(getLeagueConfig).mockResolvedValue(baseConfig());
		vi.mocked(getCachedMatchups).mockImplementation(async (_leagueId: string, week: number) => {
			if (week === 1 || week === 2) return fullWeek(WEEK_POINTS, STANDARD_PAIRS);
			if (week === PLAY_IN_WEEK) return ALL_ROSTER_IDS.map((id) => matchup(id, 0, 0));
			return [];
		});

		const projection = await getTierProjection(LEAGUE_ID);
		expect(projection.playIns.every((m) => m.winnerRosterId === null)).toBe(true);
	});
});

// ── Bug 2: a failing week fetch must not be cached ──────────────────────────────

describe('buildSeasonMatchupPP — partial fetch failure (Bug 2)', () => {
	it('a failing week fetch rejects instead of silently truncating the season, and is never cached', async () => {
		vi.mocked(fetchLeagueCore).mockResolvedValue({
			league: baseLeague({ status: 'complete', settings: { type: 0 } }),
			rosters: ALL_ROSTER_IDS.map(roster),
			users: [],
		});
		vi.mocked(getLeagueConfig).mockResolvedValue(baseConfig());
		vi.mocked(getCachedMatchups).mockImplementation(async (_leagueId: string, week: number) => {
			if (week === 1) throw new Error('Sleeper 503');
			if (week === 2) return fullWeek(WEEK_POINTS, STANDARD_PAIRS);
			return [];
		});

		await expect(getSeasonPromotionPoints(LEAGUE_ID)).rejects.toThrow('Sleeper 503');
		// The failed build must never reach the cache — with the old
		// `.catch(() => [])` this would instead resolve with week 1 silently
		// missing from the breakdown, and (status === 'complete') get cached
		// forever.
		expect(backend.set).not.toHaveBeenCalled();

		// A retry after Sleeper recovers builds the full season and DOES cache.
		vi.mocked(getCachedMatchups).mockImplementation(async (_leagueId: string, week: number) => {
			if (week === 1 || week === 2) return fullWeek(WEEK_POINTS, STANDARD_PAIRS);
			return [];
		});
		const recovered = await getSeasonPromotionPoints(LEAGUE_ID);
		expect(recovered.breakdown.some((b) => b.week === 1)).toBe(true);
		expect(backend.set).toHaveBeenCalled();
	});

	it('a genuinely empty week (nothing scheduled) is NOT an error and does not block the season', async () => {
		vi.mocked(fetchLeagueCore).mockResolvedValue({
			league: baseLeague({ status: 'in_season', settings: { type: 0, leg: 2 } }),
			rosters: ALL_ROSTER_IDS.map(roster),
			users: [],
		});
		vi.mocked(getLeagueConfig).mockResolvedValue(baseConfig());
		vi.mocked(fetchMatchups).mockImplementation(async (_leagueId: string, week: number) => {
			if (week === 1) return fullWeek(WEEK_POINTS, STANDARD_PAIRS);
			if (week === 2) return []; // legitimately nothing there yet — a normal resolved empty array
			return [];
		});

		const seasonPP = await getSeasonPromotionPoints(LEAGUE_ID);
		expect(seasonPP.breakdown.some((b) => b.week === 1)).toBe(true);
		expect(seasonPP.breakdown.some((b) => b.week === 2)).toBe(false);
	});
});

// ── Bug 3: Points For decoupled from the tier snapshot ──────────────────────────

describe('getSeasonPromotionPoints — Points For sourcing (Bug 3)', () => {
	it('a roster whose opponent is missing from the tier snapshot still gets correct, non-zero Points For, with 0 PP for those weeks', async () => {
		// Roster 2 (roster 1's opponent in both weeks, per STANDARD_PAIRS) has no
		// tier assignment. computeWeekPP drops any row where either side is
		// missing from the tier map, so roster 1 gets zero breakdown rows at all
		// — that's the correct PP outcome. Points For must NOT collapse with it.
		const tiersWithGap: Record<string, 1 | 2 | 3> = { ...TIERS_2025 };
		delete tiersWithGap['2'];

		vi.mocked(fetchLeagueCore).mockResolvedValue({
			league: baseLeague({ status: 'complete', settings: { type: 0 } }),
			rosters: ALL_ROSTER_IDS.map(roster),
			users: [],
		});
		vi.mocked(getLeagueConfig).mockResolvedValue(baseConfig({ tiersBySeason: { [SEASON]: tiersWithGap } }));
		vi.mocked(getCachedMatchups).mockImplementation(async (_leagueId: string, week: number) => {
			if (week === 1 || week === 2) return fullWeek(WEEK_POINTS, STANDARD_PAIRS);
			return [];
		});

		const seasonPP = await getSeasonPromotionPoints(LEAGUE_ID);
		const r1 = seasonPP.standings.find((s) => s.rosterId === 1)!;

		expect(r1.weeklyTotal).toBe(0); // no scoreable opponent either week → correctly 0 PP
		expect(r1.pointsFor).toBe(WEEK_POINTS[1] * 2); // but PF still sums both weeks' real points
	});
});

// ── Review fixes ─────────────────────────────────────────────────────────────

describe('clampRegularSeasonEndWeek', () => {
	it('bounds the Sleeper request fan-out at the NFL season length', () => {
		expect(clampRegularSeasonEndWeek(1400)).toBe(MAX_REGULAR_SEASON_END_WEEK);
	});

	it('treats non-finite input as garbage and falls back to the default', () => {
		// Infinity isn't a week count to be clamped — it's invalid input, so the
		// safe default is more honest than silently pinning it to the maximum.
		expect(clampRegularSeasonEndWeek(Infinity)).toBe(DEFAULT_REGULAR_SEASON_END_WEEK);
	});

	it('floors at one week and rejects non-numeric input', () => {
		expect(clampRegularSeasonEndWeek(0)).toBe(1);
		expect(clampRegularSeasonEndWeek(-5)).toBe(1);
		expect(clampRegularSeasonEndWeek(NaN)).toBe(DEFAULT_REGULAR_SEASON_END_WEEK);
	});

	it('passes a normal season through untouched', () => {
		expect(clampRegularSeasonEndWeek(14)).toBe(14);
	});
});

describe('setSeasonTiers — empty-snapshot guard', () => {
	it('refuses to persist an empty tier map', async () => {
		// An empty map only ever arises from an upstream failure; writing it would
		// erase the season's snapshot and zero out every roster's PP.
		await expect(setSeasonTiers(LEAGUE_ID, SEASON, {})).rejects.toThrow(/empty tier snapshot/i);
	});
});
