import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateLeagueId } from '$lib/server/leagueId';
import { getPowerRankings } from '$lib/server/powerRankings';

export const GET: RequestHandler = async ({ params }) => {
	const leagueId = validateLeagueId(params.leagueId);
	try {
		return json(await getPowerRankings(leagueId), {
			headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=900' },
		});
	} catch (e) {
		console.error('[power-rankings] GET failed:', e);
		throw error(502, 'Failed to load power rankings');
	}
};
