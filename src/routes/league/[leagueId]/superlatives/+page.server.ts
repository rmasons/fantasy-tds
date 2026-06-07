import type { PageServerLoad } from './$types';
import { getSuperlatives } from '$lib/server/superlatives';

export const load: PageServerLoad = async ({ params }) => {
	const entriesByKey = await getSuperlatives(params.leagueId).catch(() => null);
	return {
		entriesByKey: entriesByKey ?? {},
		loadFailed: entriesByKey === null,
	};
};
