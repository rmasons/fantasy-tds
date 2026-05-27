import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPlayers } from '$lib/server/players';

export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q')?.toLowerCase().trim() ?? '';
	if (q.length < 2) return json([]);

	const players = await getPlayers();
	const results: { id: string; name: string; pos: string; team: string }[] = [];

	for (const [id, p] of Object.entries(players)) {
		if (p.name.toLowerCase().includes(q)) {
			results.push({ id, name: p.name, pos: p.pos, team: p.team });
		}
	}

	results.sort((a, b) => {
		const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
		const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
		return aStarts - bStarts || a.name.localeCompare(b.name);
	});

	return json(results.slice(0, 8), {
		headers: { 'Cache-Control': 'no-store' },
	});
};
