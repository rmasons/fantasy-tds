import type { PageServerLoad } from './$types';
import { getHomeData } from '$lib/server/homeData';

export const load: PageServerLoad = async ({ params }) => {
	const home = await getHomeData(params.leagueId).catch(() => null);
	return {
		home,
		loadFailed: home === null,
	};
};
