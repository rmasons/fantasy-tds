import type { PageServerLoad } from './$types';
import { getPowerRankings } from '$lib/server/powerRankings';
import { getSeasonChain } from '$lib/server/standings';

export const load: PageServerLoad = async ({ params }) => {
	const [data, seasons] = await Promise.all([
		getPowerRankings(params.leagueId).catch(() => null),
		getSeasonChain(params.leagueId).catch(() => []),
	]);

	return {
		power: data,
		seasons,
		loadFailed: data === null,
	};
};
