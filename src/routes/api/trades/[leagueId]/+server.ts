import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateLeagueId } from '$lib/server/leagueId';
import { getTradeAnalytics } from '$lib/server/tradeAnalyticsData';

// Powers the season-walk on the /trades page: each past season is a distinct
// Sleeper leagueId, so the client fetches this per-season on demand.
export const GET: RequestHandler = async ({ params }) => {
	const leagueId = validateLeagueId(params.leagueId);
	try {
		return json(await getTradeAnalytics(leagueId), {
			headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=900' },
		});
	} catch (e) {
		console.error('[trades] GET failed:', e);
		throw error(502, 'Failed to load trade analytics');
	}
};
