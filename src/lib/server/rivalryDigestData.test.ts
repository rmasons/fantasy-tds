import { describe, it, expect } from 'vitest';
import { resolveDigestWeek } from './rivalryDigestData';

const MAX_REGULAR_WEEK = 14; // playoff_week_start 15

describe('resolveDigestWeek', () => {
	it('uses the display week mid-regular-season', () => {
		expect(
			resolveDigestWeek('in_season', { season_type: 'regular', display_week: 7 }, MAX_REGULAR_WEEK)
		).toBe(7);
	});

	it('clamps the display week into the regular season', () => {
		// Sleeper can report display_week 0 before kickoff and >14 late in the year.
		expect(
			resolveDigestWeek('in_season', { season_type: 'regular', display_week: 0 }, MAX_REGULAR_WEEK)
		).toBe(1);
		expect(
			resolveDigestWeek('in_season', { season_type: 'regular', display_week: 18 }, MAX_REGULAR_WEEK)
		).toBe(MAX_REGULAR_WEEK);
	});

	it('pins a complete season to the last regular-season week', () => {
		expect(
			resolveDigestWeek('complete', { season_type: 'regular', display_week: 3 }, MAX_REGULAR_WEEK)
		).toBe(MAX_REGULAR_WEEK);
	});

	it('pins the postseason to the last regular-season week', () => {
		expect(
			resolveDigestWeek('in_season', { season_type: 'post', display_week: 20 }, MAX_REGULAR_WEEK)
		).toBe(MAX_REGULAR_WEEK);
	});

	it('falls back to week 1 in the pre/off-season', () => {
		expect(
			resolveDigestWeek('drafting', { season_type: 'pre', display_week: 1 }, MAX_REGULAR_WEEK)
		).toBe(1);
	});
});
