import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateLeagueId } from '$lib/server/leagueId';
import { getCachedLeague } from '$lib/server/sleeperCache';
import { loadRivalryDigest } from '$lib/server/rivalryDigestData';

export const GET: RequestHandler = async ({ params, url }) => {
	const leagueId = validateLeagueId(params.leagueId);

	// Allow caller to override week (defaults to the current regular-season week).
	const weekParam = url.searchParams.get('week');

	try {
		let week: number | undefined;
		if (weekParam) {
			const league = await getCachedLeague(leagueId);
			const maxRegularWeek = (league.settings?.playoff_week_start ?? 15) - 1;
			week = parseInt(weekParam, 10);
			if (!Number.isInteger(week) || week < 1 || week > maxRegularWeek) {
				throw error(400, 'Invalid week');
			}
		}

		return json(await loadRivalryDigest(leagueId, week), {
			headers: { 'Cache-Control': 'private, max-age=120, stale-while-revalidate=300' },
		});
	} catch (e: unknown) {
		if (e && typeof e === 'object' && 'status' in e) throw e; // re-throw SvelteKit errors
		console.error('[rivalry-digest] GET failed:', e);
		throw error(502, 'Failed to compute rivalry digest');
	}
};
