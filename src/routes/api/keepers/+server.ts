import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getKeeperData } from '$lib/server/keepers';
import { validateLeagueId } from '$lib/server/leagueId';

export const GET: RequestHandler = async ({ url }) => {
	const leagueId = validateLeagueId(url.searchParams.get('leagueId'));
	try {
		return json(await getKeeperData(leagueId));
	} catch (e) {
		console.error('[keepers] GET failed:', e);
		throw error(502, 'Failed to load keeper data');
	}
};
