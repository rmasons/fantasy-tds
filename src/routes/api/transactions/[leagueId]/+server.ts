import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateLeagueId } from '$lib/server/leagueId';
import { getTransactions } from '$lib/server/transactions';

export const GET: RequestHandler = async ({ params }) => {
	const leagueId = validateLeagueId(params.leagueId);
	try {
		return json(await getTransactions(leagueId), {
			headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=900' },
		});
	} catch (e) {
		console.error('[transactions] GET failed:', e);
		throw error(502, 'Failed to load transactions');
	}
};
