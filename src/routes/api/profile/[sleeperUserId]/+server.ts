import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getManagerProfile, getManagerLeagueProfile } from '$lib/server/managerProfile';

export const GET: RequestHandler = async ({ params, url }) => {
	const { sleeperUserId } = params;
	if (!/^\d+$/.test(sleeperUserId)) throw error(400, 'Invalid user ID.');
	const leagueId = url.searchParams.get('leagueId');

	const [global, league] = await Promise.all([
		getManagerProfile(sleeperUserId),
		leagueId ? getManagerLeagueProfile(sleeperUserId, leagueId) : Promise.resolve(null),
	]);

	return json({ global, league });
}
