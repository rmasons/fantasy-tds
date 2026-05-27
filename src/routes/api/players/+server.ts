import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlayers } from '$lib/server/players';

export const GET: RequestHandler = async () => {
	const players = await getPlayers();
	return json(players, { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600' } });
};
