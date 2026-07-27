import { describe, it, expect } from 'vitest';
import { resolveKeeperHistory } from './keeperHistory';
import type { DraftHistory } from './keeperHistory';
import { roundToBaseCost, calcKeeperCost } from './keeperCost';

/** Terse builder: season → [playerId, round, isKeeper][] */
function history(seasons: Record<string, Array<[string, number, boolean]>>): DraftHistory {
	const out: DraftHistory = {};
	for (const [season, picks] of Object.entries(seasons)) {
		out[season] = {};
		for (const [playerId, round, isKeeper] of picks) {
			out[season][playerId] = { round, isKeeper, rosterId: null };
		}
	}
	return out;
}

describe('resolveKeeperHistory', () => {
	it('drafted last season, never kept → 0 years, base from that draft', () => {
		const h = history({ '2025': [['p', 3, false]], '2024': [] });
		expect(resolveKeeperHistory(h, 'p', 2026)).toEqual({
			yearsKept: 0,
			draftRound: 3,
			draftSeason: '2025',
			acquiredSeason: '2025',
		});
	});

	it('drafted then kept once → 1 year, base still from the original draft', () => {
		const h = history({
			'2025': [['p', 3, true]],   // kept into 2025
			'2024': [['p', 3, false]],  // originally drafted R3 in 2024
		});
		expect(resolveKeeperHistory(h, 'p', 2026)).toEqual({
			yearsKept: 1,
			draftRound: 3,
			draftSeason: '2024',
			acquiredSeason: '2024',
		});
	});

	it('kept three seasons running → 3 years', () => {
		const h = history({
			'2025': [['p', 1, true]],
			'2024': [['p', 1, true]],
			'2023': [['p', 1, true]],
			'2022': [['p', 1, false]],
		});
		const r = resolveKeeperHistory(h, 'p', 2026);
		expect(r.yearsKept).toBe(3);
		expect(r.draftSeason).toBe('2022');
	});

	// ── The two reported bugs ────────────────────────────────────────────────

	it('waiver pickup that was kept counts as kept (Bucky Irving case)', () => {
		// Undrafted in 2024 (added off waivers mid-season), kept into 2025.
		// The old gap-based logic found no ordinary draft pick and reported him
		// as never kept, at the $5 floor with no escalation.
		const h = history({
			'2025': [['bucky', 9, true]],
			'2024': [['someone-else', 1, false]],
		});
		const r = resolveKeeperHistory(h, 'bucky', 2026);
		expect(r.yearsKept).toBe(1);
		expect(r.draftRound).toBeNull();   // never drafted — floors to $5
		expect(r.draftSeason).toBeNull();
		expect(r.acquiredSeason).toBe('2024');
	});

	it('drafted years ago, dropped, re-added off waivers → not kept (Cade Otton case)', () => {
		// Drafted R12 in 2023, dropped, back on a roster via waivers. No keeper
		// pick in 2024 or 2025, so the streak is zero — the old logic charged him
		// as if he had been held since 2023.
		const h = history({
			'2025': [['other', 1, false]],
			'2024': [['other', 1, false]],
			'2023': [['otton', 12, false]],
		});
		const r = resolveKeeperHistory(h, 'otton', 2026);
		expect(r.yearsKept).toBe(0);
		expect(r.draftRound).toBeNull();
		expect(r.draftSeason).toBeNull();
		expect(r.acquiredSeason).toBe('2025');
	});

	// ── Edges ────────────────────────────────────────────────────────────────

	it('player absent from all history → 0 years, undrafted', () => {
		const h = history({ '2025': [], '2024': [] });
		expect(resolveKeeperHistory(h, 'ghost', 2026)).toEqual({
			yearsKept: 0,
			draftRound: null,
			draftSeason: null,
			acquiredSeason: '2025',
		});
	});

	it('empty history (walk failed) → 0 years and no acquisition season', () => {
		expect(resolveKeeperHistory({}, 'p', 2026)).toEqual({
			yearsKept: 0,
			draftRound: null,
			draftSeason: null,
			acquiredSeason: null,
		});
	});

	it('streak stops at the edge of the league lineage', () => {
		// League's first season is 2024 and the player was kept every year since.
		const h = history({ '2025': [['p', 5, true]], '2024': [['p', 5, true]] });
		const r = resolveKeeperHistory(h, 'p', 2026);
		expect(r.yearsKept).toBe(2);
		expect(r.acquiredSeason).toBeNull(); // 2023 predates the league
	});

	it('planning year draft picks are ignored — keepers are chosen for it', () => {
		const h = history({ '2026': [['p', 4, false]], '2025': [['p', 4, false]] });
		expect(resolveKeeperHistory(h, 'p', 2026).draftSeason).toBe('2025');
	});

	it('a keeper pick never anchors base cost', () => {
		// 2024 exists but only holds a keeper entry (its ordinary draft failed to
		// load). Better to floor to $5 than invent a round from a keeper slot.
		const h = history({ '2025': [['p', 2, false]] });
		expect(resolveKeeperHistory(h, 'p', 2026).draftRound).toBe(2);
		const h2 = history({ '2025': [['p', 2, true]], '2024': [['p', 8, true]] });
		expect(resolveKeeperHistory(h2, 'p', 2026).draftRound).toBeNull();
	});
});

// ── End-to-end pricing ─────────────────────────────────────────────────────────

describe('keeper history → cost', () => {
	function price(h: DraftHistory, playerId: string, planningYear: number) {
		const r = resolveKeeperHistory(h, playerId, planningYear);
		const base = r.draftRound !== null ? roundToBaseCost(r.draftRound) : 5;
		return calcKeeperCost(base, r.yearsKept);
	}

	it('first-time keeper off an R1 pick → $75 × 1.2 = $90', () => {
		const h = history({ '2025': [['p', 1, false]] });
		expect(price(h, 'p', 2026)).toBe(90);
	});

	it('second-year keeper off an R1 pick → $75 × 1.4 = $105', () => {
		const h = history({ '2025': [['p', 1, true]], '2024': [['p', 1, false]] });
		expect(price(h, 'p', 2026)).toBe(105);
	});

	it('kept waiver pickup → $5 × 1.4 = $7', () => {
		const h = history({ '2025': [['p', 9, true]], '2024': [] });
		expect(price(h, 'p', 2026)).toBe(7);
	});

	it('re-added waiver player → $5 × 1.2 = $6', () => {
		const h = history({ '2025': [], '2024': [['p', 12, false]] });
		expect(price(h, 'p', 2026)).toBe(6);
	});
});
