import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getKeeperData } from '$lib/server/keepers';

export const GET: RequestHandler = async ({ url }) => {
	const leagueId = url.searchParams.get('leagueId');
	if (!leagueId || !/^[\w-]+$/.test(leagueId)) throw error(400, 'Missing or invalid leagueId');
	try {
		return json(await getKeeperData(leagueId));
	} catch (e) {
		console.error('[keepers] GET failed:', e);
		throw error(502, 'Failed to load keeper data');
	}
};
