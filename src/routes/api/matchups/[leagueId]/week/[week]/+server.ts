import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateLeagueId } from '$lib/server/leagueId';
import { getCachedMatchups } from '$lib/server/sleeperCache';

export const GET: RequestHandler = async ({ params, url }) => {
	const leagueId = validateLeagueId(params.leagueId);
	const week = parseInt(params.week, 10);
	if (!Number.isInteger(week) || week < 1 || week > 30) throw error(400, 'Invalid week');

	// ?live=1 bypasses the cache for in-progress weeks so scores stay fresh.
	const live = url.searchParams.get('live') === '1';

	try {
		return json(await getCachedMatchups(leagueId, week, live), {
			headers: { 'Cache-Control': live ? 'no-store' : 'public, max-age=300, stale-while-revalidate=900' },
		});
	} catch (e) {
		console.error('[matchups/week] GET failed:', e);
		throw error(502, 'Failed to load week matchups');
	}
};
