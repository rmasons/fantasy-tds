import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountPage, stubFetch, type FetchStub } from '$lib/test/mountPage';
import Page from './+page.svelte';

function entry(id: string) {
	return { rosterId: 1, ownerId: id, teamName: `Team ${id}`, ownerName: `Owner ${id}`, avatar: null };
}

function pageData(overrides: Record<string, unknown> = {}) {
	return {
		leagueId: 'L1',
		user: null,
		podiums: [
			{ season: '2024', champion: entry('a'), second: entry('b'), third: entry('c'), toilet: entry('d') },
			{ season: '2023', champion: entry('e'), second: null, third: null, toilet: null },
		],
		seasonLidMap: { '2024': 'lid2024', '2023': 'lid2023' },
		loadFailed: false,
		...overrides,
	};
}

let fetches: FetchStub;

beforeEach(() => {
	fetches = stubFetch();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('Awards & Records page', () => {
	// Regression: the setup effect used to call loadYearRecords() in its tracked
	// scope, where the read of yearRecordsCache became a dependency that the same
	// call then wrote to — Svelte gave up with effect_update_depth_exceeded and
	// the page died on hydration.
	it('hydrates without an effect loop', () => {
		const { html } = mountPage(Page, { data: pageData() });
		expect(html).toContain('Awards &amp; Records');
		for (const tab of ['2024', '2023', 'All Time']) expect(html).toContain(tab);
	});

	it('warms the default year and the current season on mount', () => {
		mountPage(Page, { data: pageData() });
		// Default tab is the most recent completed season, eagerly loaded...
		expect(fetches.calls).toContain('/api/records/lid2024');
		// ...alongside the in-progress season and the podium profile enrichment.
		expect(fetches.calls).toContain('/api/records/L1');
		expect(fetches.calls.some((u) => u.startsWith('/api/profiles?ids='))).toBe(true);
		// Exactly those three: the setup effect must run once, not repeatedly.
		expect(fetches.calls).toHaveLength(3);
	});

	it('hydrates with no completed seasons', () => {
		const { html } = mountPage(Page, { data: pageData({ podiums: [], seasonLidMap: {} }) });
		expect(html).toContain('Awards &amp; Records');
		expect(fetches.calls.some((u) => u.startsWith('/api/profiles?ids='))).toBe(false);
	});

	it('hydrates when the server load failed', () => {
		const { html } = mountPage(Page, { data: pageData({ podiums: [], seasonLidMap: {}, loadFailed: true }) });
		expect(html).toContain('Awards &amp; Records');
		// Only the in-progress season is requested; there are no podiums to enrich.
		expect(fetches.calls).toEqual(['/api/records/L1']);
	});
});
