import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateLeagueId } from '$lib/server/leagueId';
import { getRivalry } from '$lib/server/rivalry';

export const GET: RequestHandler = async ({ params, url }) => {
	const leagueId = validateLeagueId(params.leagueId);
	const one = url.searchParams.get('one') ?? '';
	const two = url.searchParams.get('two') ?? '';

	if (!/^\d+$/.test(one) || !/^\d+$/.test(two)) throw error(400, 'Invalid manager ids');
	if (one === two) throw error(400, 'Pick two different managers');

	try {
		return json(await getRivalry(leagueId, one, two), {
			headers: { 'Cache-Control': 'private, max-age=300' },
		});
	} catch (e) {
		console.error('[rivalry] GET failed:', e);
		throw error(502, 'Failed to analyze rivalry');
	}
};
