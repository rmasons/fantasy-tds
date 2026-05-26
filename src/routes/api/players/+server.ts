import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlayers } from '$lib/server/players';

export const GET: RequestHandler = async () => {
	const players = await getPlayers();
	return json(players);
};
