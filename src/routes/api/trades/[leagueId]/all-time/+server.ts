import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateLeagueId } from '$lib/server/leagueId';
import { getAllTimeTradeAnalytics } from '$lib/server/tradeAnalyticsData';

// All-time trade analytics across the whole season chain for this league.
export const GET: RequestHandler = async ({ params }) => {
	const leagueId = validateLeagueId(params.leagueId);
	try {
		return json(await getAllTimeTradeAnalytics(leagueId), {
			headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=900' },
		});
	} catch (e) {
		console.error('[trades all-time] GET failed:', e);
		throw error(502, 'Failed to load all-time trade analytics');
	}
};
