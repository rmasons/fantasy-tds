import { describe, it, expect } from 'vitest';
import { computeRivalryDigest, buildDigestItem } from './rivalryDigest';
import type { WeeklyPairing } from './rivalryDigest';
import type { RivalryResult, ManagerOption } from './rivalry';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mgr = (id: string, name: string): ManagerOption => ({
	userId: id,
	displayName: name,
	teamName: name,
	avatar: null,
});

const emptyRecord = (): RivalryResult => ({
	wins: { one: 0, two: 0 },
	ties: 0,
	points: { one: 0, two: 0 },
	matchups: [],
});

function makeRecord(
	winsOne: number,
	winsTwo: number,
	ties = 0,
	extra?: Partial<RivalryResult>,
): RivalryResult {
	const matchups: RivalryResult['matchups'] = [];
	// Build matchups from wins — most recent first (matchups[0] = latest)
	for (let i = 0; i < winsOne; i++)
		matchups.push({ season: '2024', week: i + 1, teamOne: { points: 120 }, teamTwo: { points: 100 } });
	for (let i = 0; i < winsTwo; i++)
		matchups.push({ season: '2024', week: i + 1 + winsOne, teamOne: { points: 100 }, teamTwo: { points: 120 } });
	for (let i = 0; i < ties; i++)
		matchups.push({ season: '2024', week: i + 1 + winsOne + winsTwo, teamOne: { points: 110 }, teamTwo: { points: 110 } });

	return {
		wins: { one: winsOne, two: winsTwo },
		ties,
		points: { one: 120 * winsOne + 100 * winsTwo + 110 * ties, two: 100 * winsOne + 120 * winsTwo + 110 * ties },
		matchups,
		...extra,
	};
}

const managers = [mgr('u1', 'Alpha'), mgr('u2', 'Beta'), mgr('u3', 'Gamma'), mgr('u4', 'Delta')];

// ── buildDigestItem tests ─────────────────────────────────────────────────────

describe('buildDigestItem', () => {
	it('returns null when a manager is missing from options', () => {
		const pairing: WeeklyPairing = { managerOneId: 'u1', managerTwoId: 'unknown' };
		const result = buildDigestItem(pairing, emptyRecord(), managers);
		expect(result).toBeNull();
	});

	it('signals first_meeting when no history', () => {
		const pairing: WeeklyPairing = { managerOneId: 'u1', managerTwoId: 'u2' };
		const result = buildDigestItem(pairing, emptyRecord(), managers);
		expect(result).not.toBeNull();
		expect(result!.signals).toContain('first_meeting');
		expect(result!.headline).toMatch(/first-ever meeting/i);
		expect(result!.interestScore).toBeGreaterThan(0);
	});

	it('signals tied_series for perfectly equal records', () => {
		const pairing: WeeklyPairing = { managerOneId: 'u1', managerTwoId: 'u2' };
		const record = makeRecord(4, 4);
		const result = buildDigestItem(pairing, record, managers);
		expect(result).not.toBeNull();
		expect(result!.signals).toContain('tied_series');
		expect(result!.headline).toMatch(/4.+4/);
	});

	it('signals revenge_game when there is a last-meeting loser', () => {
		// Beta lost last (most recent matchup has one winning)
		const record: RivalryResult = {
			wins: { one: 3, two: 2 },
			ties: 0,
			points: { one: 600, two: 500 },
			matchups: [
				// matchups[0] = most recent: one wins
				{ season: '2024', week: 8, teamOne: { points: 130 }, teamTwo: { points: 110 } },
				{ season: '2024', week: 5, teamOne: { points: 100 }, teamTwo: { points: 120 } },
			],
		};
		const pairing: WeeklyPairing = { managerOneId: 'u1', managerTwoId: 'u2' };
		const result = buildDigestItem(pairing, record, managers);
		expect(result).not.toBeNull();
		expect(result!.signals).toContain('revenge_game');
		// The loser of last meeting (Beta = u2) should appear in headline or subline
		const text = result!.headline + ' ' + result!.subline;
		expect(text).toMatch(/Beta/i);
	});

	it('signals streak_on_the_line for 3+ consecutive wins', () => {
		const record: RivalryResult = {
			wins: { one: 5, two: 2 },
			ties: 0,
			points: { one: 700, two: 500 },
			matchups: [
				// Most recent 3 are all won by one (descending week order)
				{ season: '2024', week: 9, teamOne: { points: 130 }, teamTwo: { points: 90 } },
				{ season: '2024', week: 7, teamOne: { points: 120 }, teamTwo: { points: 100 } },
				{ season: '2024', week: 5, teamOne: { points: 115 }, teamTwo: { points: 105 } },
				{ season: '2024', week: 3, teamOne: { points: 90 }, teamTwo: { points: 120 } },
				{ season: '2024', week: 1, teamOne: { points: 90 }, teamTwo: { points: 120 } },
			],
		};
		const pairing: WeeklyPairing = { managerOneId: 'u1', managerTwoId: 'u2' };
		const result = buildDigestItem(pairing, record, managers);
		expect(result).not.toBeNull();
		expect(result!.signals).toContain('streak_on_the_line');
	});

	it('signals lopsided_series when one manager wins ≥60% over 5+ games', () => {
		// Alpha wins 5 out of 7
		const record = makeRecord(5, 2);
		const pairing: WeeklyPairing = { managerOneId: 'u1', managerTwoId: 'u2' };
		const result = buildDigestItem(pairing, record, managers);
		expect(result).not.toBeNull();
		expect(result!.signals).toContain('lopsided_series');
	});

	it('does NOT signal lopsided_series with fewer than 5 games', () => {
		const record = makeRecord(3, 0); // only 3 games
		const pairing: WeeklyPairing = { managerOneId: 'u1', managerTwoId: 'u2' };
		const result = buildDigestItem(pairing, record, managers);
		expect(result).not.toBeNull();
		expect(result!.signals).not.toContain('lopsided_series');
	});

	it('signals high_scoring_rivalry when avg combined points ≥ 240', () => {
		const record: RivalryResult = {
			wins: { one: 1, two: 1 },
			ties: 0,
			points: { one: 260, two: 240 }, // avg combined = (500/2) = 250 per game
			matchups: [
				{ season: '2024', week: 3, teamOne: { points: 140 }, teamTwo: { points: 120 } },
				{ season: '2024', week: 1, teamOne: { points: 120 }, teamTwo: { points: 120 } },
			],
		};
		const pairing: WeeklyPairing = { managerOneId: 'u1', managerTwoId: 'u2' };
		const result = buildDigestItem(pairing, record, managers);
		expect(result).not.toBeNull();
		expect(result!.signals).toContain('high_scoring_rivalry');
	});

	it('produces a non-empty headline and subline for all edge cases', () => {
		// Ties only
		const tiedRecord: RivalryResult = {
			wins: { one: 0, two: 0 },
			ties: 3,
			points: { one: 330, two: 330 },
			matchups: [
				{ season: '2024', week: 3, teamOne: { points: 110 }, teamTwo: { points: 110 } },
				{ season: '2024', week: 2, teamOne: { points: 110 }, teamTwo: { points: 110 } },
				{ season: '2024', week: 1, teamOne: { points: 110 }, teamTwo: { points: 110 } },
			],
		};
		const pairing: WeeklyPairing = { managerOneId: 'u1', managerTwoId: 'u2' };
		const result = buildDigestItem(pairing, tiedRecord, managers);
		expect(result).not.toBeNull();
		expect(result!.headline.length).toBeGreaterThan(0);
		expect(result!.subline.length).toBeGreaterThan(0);
	});
});

// ── computeRivalryDigest tests ────────────────────────────────────────────────

describe('computeRivalryDigest', () => {
	it('returns empty array for empty pairings', () => {
		const result = computeRivalryDigest([], new Map(), managers);
		expect(result).toEqual([]);
	});

	it('handles missing record gracefully (treats as first meeting)', () => {
		const pairings: WeeklyPairing[] = [{ managerOneId: 'u1', managerTwoId: 'u2' }];
		const records = new Map<string, RivalryResult>(); // empty — no record
		const result = computeRivalryDigest(pairings, records, managers);
		expect(result).toHaveLength(1);
		expect(result[0].signals).toContain('first_meeting');
	});

	it('looks up records with canonical (sorted) key regardless of pairing order', () => {
		// Pairing has u2 first, but record is stored under u1_u2
		const pairings: WeeklyPairing[] = [{ managerOneId: 'u2', managerTwoId: 'u1' }];
		const records = new Map<string, RivalryResult>([
			['u1_u2', makeRecord(4, 4)],
		]);
		const result = computeRivalryDigest(pairings, records, managers);
		expect(result).toHaveLength(1);
		expect(result[0].signals).toContain('tied_series');
	});

	it('uses pairing-oriented record — names the correct manager in an asymmetric headline', () => {
		// Non-canonical pairing (u2 first) with a pairing-oriented record: wins.one
		// belongs to u2. u1 (Alpha) leads 6–1, so Alpha — not Beta — must be named.
		// A symmetric record can't catch an orientation flip; this asymmetric one can.
		const pairings: WeeklyPairing[] = [{ managerOneId: 'u2', managerTwoId: 'u1' }];
		const records = new Map<string, RivalryResult>([
			['u1_u2', makeRecord(1, 6)], // wins.one = 1 (u2/Beta), wins.two = 6 (u1/Alpha)
		]);
		const result = computeRivalryDigest(pairings, records, managers);
		expect(result).toHaveLength(1);
		expect(result[0].signals).toContain('lopsided_series');
		expect(result[0].headline).toMatch(/Alpha/i);
		expect(result[0].headline).not.toMatch(/Beta/i);
	});

	it('ranks tied_series above lopsided_series', () => {
		const pairings: WeeklyPairing[] = [
			{ managerOneId: 'u1', managerTwoId: 'u2' }, // lopsided
			{ managerOneId: 'u3', managerTwoId: 'u4' }, // tied
		];
		const records = new Map<string, RivalryResult>([
			['u1_u2', makeRecord(6, 1)],     // lopsided
			['u3_u4', makeRecord(4, 4)],     // tied
		]);
		const result = computeRivalryDigest(pairings, records, managers);
		expect(result).toHaveLength(2);
		// Tied series (score 10) should outrank lopsided (score 4)
		expect(result[0].managerOne.userId === 'u3' || result[0].managerTwo.userId === 'u3').toBe(true);
	});

	it('ranks tied_series (score 10) above first_meeting (score 7)', () => {
		// Verifies the ordering between two specific signals.
		const pairings: WeeklyPairing[] = [
			{ managerOneId: 'u1', managerTwoId: 'u2' }, // first meeting → score 7
			{ managerOneId: 'u3', managerTwoId: 'u4' }, // tied 3–3 → score ≥10
		];
		const records = new Map<string, RivalryResult>([
			// u1_u2 not in map → first meeting
			['u3_u4', makeRecord(3, 3)], // tied series
		]);
		const result = computeRivalryDigest(pairings, records, managers);
		expect(result).toHaveLength(2);
		// tied_series score=10 > first_meeting score=7
		const firstPair = result[0];
		expect(
			firstPair.managerOne.userId === 'u3' || firstPair.managerTwo.userId === 'u3' ||
			firstPair.managerOne.userId === 'u4' || firstPair.managerTwo.userId === 'u4'
		).toBe(true);
	});

	it('includes all pairings even when some managers are missing', () => {
		const pairings: WeeklyPairing[] = [
			{ managerOneId: 'u1', managerTwoId: 'u2' },
			{ managerOneId: 'u1', managerTwoId: 'ghost' }, // ghost not in managers
		];
		const records = new Map<string, RivalryResult>();
		const result = computeRivalryDigest(pairings, records, managers);
		// Only the valid pairing should appear
		expect(result).toHaveLength(1);
		expect(result[0].managerOne.userId).toBe('u1');
		expect(result[0].managerTwo.userId).toBe('u2');
	});

	it('returns interestScore > 0 for every item', () => {
		const pairings: WeeklyPairing[] = [
			{ managerOneId: 'u1', managerTwoId: 'u2' },
			{ managerOneId: 'u3', managerTwoId: 'u4' },
		];
		const records = new Map<string, RivalryResult>([
			['u1_u2', emptyRecord()],     // first meeting
			['u3_u4', makeRecord(3, 2)],  // generic record
		]);
		const result = computeRivalryDigest(pairings, records, managers);
		for (const item of result) {
			expect(item.interestScore).toBeGreaterThan(0);
		}
	});
});
