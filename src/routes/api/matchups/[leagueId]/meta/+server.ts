import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateLeagueId } from '$lib/server/leagueId';
import { getMatchupsMeta } from '$lib/server/matchups';

export const GET: RequestHandler = async ({ params }) => {
	const leagueId = validateLeagueId(params.leagueId);
	try {
		return json(await getMatchupsMeta(leagueId), {
			headers: { 'Cache-Control': 'public, max-age=120, stale-while-revalidate=300' },
		});
	} catch (e) {
		console.error('[matchups/meta] GET failed:', e);
		throw error(502, 'Failed to load matchups');
	}
};
