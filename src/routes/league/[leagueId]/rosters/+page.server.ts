import type { PageServerLoad } from './$types';
import { getRosters } from '$lib/server/rosters';
import { getSeasonChain } from '$lib/server/standings';

export const load: PageServerLoad = async ({ params }) => {
	const [teams, seasons] = await Promise.all([
		getRosters(params.leagueId).catch(() => null),
		getSeasonChain(params.leagueId).catch(() => []),
	]);

	return {
		teams: teams ?? [],
		seasons,
		loadFailed: teams === null,
	};
};
