import { describe, it, expect } from 'vitest';
import {
	EGGS,
	EGG_IDS,
	TOTAL_EGGS,
	MAX_CLAIMS_PER_USER,
	eggMeta,
	DIFFICULTY_LABEL,
	DIFFICULTY_ORDER,
	type EggDifficulty,
} from './eggs';

describe('egg hunt metadata', () => {
	it('has unique egg ids', () => {
		const ids = EGGS.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('keeps EGG_IDS and TOTAL_EGGS in sync with EGGS', () => {
		expect(EGG_IDS.size).toBe(EGGS.length);
		expect(TOTAL_EGGS).toBe(EGGS.length);
		for (const e of EGGS) expect(EGG_IDS.has(e.id)).toBe(true);
	});

	it('gives every egg a non-empty location and a known difficulty', () => {
		for (const e of EGGS) {
			expect(e.location.trim().length).toBeGreaterThan(0);
			expect(DIFFICULTY_ORDER).toContain(e.difficulty);
		}
	});

	it('caps per-user claims below the total so the hunt stays competitive', () => {
		expect(MAX_CLAIMS_PER_USER).toBeGreaterThan(0);
		expect(MAX_CLAIMS_PER_USER).toBeLessThan(TOTAL_EGGS);
	});
});

describe('eggMeta', () => {
	it('returns metadata for a known id', () => {
		expect(eggMeta(EGGS[0].id)).toEqual(EGGS[0]);
	});

	it('returns undefined for an unknown id', () => {
		expect(eggMeta('does-not-exist')).toBeUndefined();
	});
});

describe('difficulty tables', () => {
	it('labels every difficulty in DIFFICULTY_ORDER', () => {
		for (const d of DIFFICULTY_ORDER) {
			expect(DIFFICULTY_LABEL[d]).toBeTruthy();
		}
	});

	it('orders difficulties from easy to expert', () => {
		expect(DIFFICULTY_ORDER).toEqual<EggDifficulty[]>(['easy', 'medium', 'hard', 'expert']);
	});
});
