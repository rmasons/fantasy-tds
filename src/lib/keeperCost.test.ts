import { describe, it, expect } from 'vitest';
import { roundToBaseCost, calcKeeperCost, computeScenario } from './keeperCost';
import type { ScenarioPlayer } from './keeperCost';

// ── roundToBaseCost ────────────────────────────────────────────────────────────

describe('roundToBaseCost', () => {
	it('R1 → $75', () => expect(roundToBaseCost(1)).toBe(75));
	it('R2 → $70', () => expect(roundToBaseCost(2)).toBe(70));
	it('R14 → $10', () => expect(roundToBaseCost(14)).toBe(10));
	it('R15 → $5 (floor)', () => expect(roundToBaseCost(15)).toBe(5));
	it('R20 → $5 (well past floor)', () => expect(roundToBaseCost(20)).toBe(5));
	it('R0 → $80 (hypothetical, no floor triggered)', () => expect(roundToBaseCost(0)).toBe(80));
});

// ── calcKeeperCost ─────────────────────────────────────────────────────────────

describe('calcKeeperCost', () => {
	it('base=$75, years=0 → ceil(75 × 1.20) = $90', () => {
		expect(calcKeeperCost(75, 0)).toBe(90);
	});

	it('base=$75, years=1 (second year kept) → ceil(75 × 1.40) = $105', () => {
		expect(calcKeeperCost(75, 1)).toBe(105);
	});

	it('base=$5, years=0 → ceil(5 × 1.20) = $6', () => {
		expect(calcKeeperCost(5, 0)).toBe(6);
	});

	it('base=$5, years=2 → ceil(5 × 1.60) = $8', () => {
		expect(calcKeeperCost(5, 2)).toBe(8);
	});

	it('base=$0 (sub-$1 floor) → uses effective=$5, years=0 → $6', () => {
		// undrafted/FAAB players can have baseCost < 1; floor to 5
		expect(calcKeeperCost(0, 0)).toBe(6);
	});

	it('base admin override $20, years=3 → ceil(20 × 1.80) = $36', () => {
		expect(calcKeeperCost(20, 3)).toBe(36);
	});

	it('result is always an integer (ceiling)', () => {
		// base=7, years=0: 7 × 1.20 = 8.40 → ceil = 9
		expect(Number.isInteger(calcKeeperCost(7, 0))).toBe(true);
		expect(calcKeeperCost(7, 0)).toBe(9);
	});
});

// ── computeScenario ───────────────────────────────────────────────────────────

/** Convenience builder for test players. */
function players(...defs: Array<[id: string, cost: number]>): ScenarioPlayer[] {
	return defs.map(([playerId, keeperCost]) => ({ playerId, keeperCost }));
}

describe('computeScenario', () => {
	const roster = players(
		['p1', 90],   // $90 keeper (R1, first year)
		['p2', 70],   // $70 keeper (R2, first year)
		['p3', 6],    // $6 keeper (floor, first year)
		['p4', 105],  // $105 keeper (R1, second year)
	);

	it('zero kept → count=0, cost=0, faabAfter=faabRemaining', () => {
		const r = computeScenario(new Set(), roster, 100, 3);
		expect(r).toEqual({ count: 0, totalCost: 0, faabAfter: 100, overLimit: false });
	});

	it('one player kept → correct single-player totals', () => {
		const r = computeScenario(new Set(['p1']), roster, 150, 3);
		expect(r).toEqual({ count: 1, totalCost: 90, faabAfter: 60, overLimit: false });
	});

	it('max keepers (limit=3, keeping 3) → overLimit=false', () => {
		const r = computeScenario(new Set(['p1', 'p2', 'p3']), roster, 200, 3);
		expect(r.count).toBe(3);
		expect(r.totalCost).toBe(166);
		expect(r.overLimit).toBe(false);
	});

	it('over limit (limit=3, keeping 4) → overLimit=true', () => {
		const r = computeScenario(new Set(['p1', 'p2', 'p3', 'p4']), roster, 500, 3);
		expect(r.count).toBe(4);
		expect(r.overLimit).toBe(true);
	});

	it('maxKeepers=0 (no limit configured) → overLimit always false', () => {
		const r = computeScenario(new Set(['p1', 'p2', 'p3', 'p4']), roster, 500, 0);
		expect(r.overLimit).toBe(false);
	});

	it('faabRemaining=null → faabAfter=null', () => {
		const r = computeScenario(new Set(['p1']), roster, null, 3);
		expect(r.faabAfter).toBeNull();
	});

	it('faabAfter can go negative (over budget)', () => {
		const r = computeScenario(new Set(['p1', 'p2', 'p3', 'p4']), roster, 50, 0);
		expect(r.faabAfter).toBe(50 - (90 + 70 + 6 + 105)); // -221
	});

	it('player IDs not on roster are ignored silently', () => {
		const r = computeScenario(new Set(['p1', 'ghost-player']), roster, 100, 3);
		expect(r.count).toBe(1);
		expect(r.totalCost).toBe(90);
	});

	it('years-kept escalation is captured in the pre-priced cost (integration)', () => {
		// p4 at $105 = R1 base $75, kept 1 year: ceil(75 × 1.40) = 105
		const r = computeScenario(new Set(['p4']), roster, 200, 3);
		expect(r.totalCost).toBe(105);
	});
});
