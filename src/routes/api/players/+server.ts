import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlayers } from '$lib/server/players';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) return json({ error: 'Unauthorized' }, { status: 401 });
	const players = await getPlayers();
	return json(players);
};
