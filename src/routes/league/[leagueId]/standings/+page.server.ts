import type { PageServerLoad } from './$types';
import { getStandings, getSeasonChain } from '$lib/server/standings';

export const load: PageServerLoad = async ({ params }) => {
	const [result, seasons] = await Promise.all([
		getStandings(params.leagueId).catch(() => null),
		getSeasonChain(params.leagueId).catch(() => []),
	]);

	return {
		leagueId: params.leagueId,
		standings: result?.standings ?? [],
		season: result?.season ?? '',
		status: result?.status ?? '',
		seasons,
		loadFailed: result === null,
	};
};
