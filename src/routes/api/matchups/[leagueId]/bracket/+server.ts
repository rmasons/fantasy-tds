import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateLeagueId } from '$lib/server/leagueId';
import { getBracket } from '$lib/server/matchups';

export const GET: RequestHandler = async ({ params }) => {
	const leagueId = validateLeagueId(params.leagueId);
	try {
		return json(await getBracket(leagueId), {
			headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=900' },
		});
	} catch (e) {
		console.error('[matchups/bracket] GET failed:', e);
		throw error(502, 'Failed to load bracket');
	}
};
