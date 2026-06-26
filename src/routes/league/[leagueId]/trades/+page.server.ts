import type { PageServerLoad } from './$types';
import { getTradeAnalytics } from '$lib/server/tradeAnalyticsData';
import { getSeasonChain } from '$lib/server/standings';

export const load: PageServerLoad = async ({ params }) => {
	const [data, seasons] = await Promise.all([
		getTradeAnalytics(params.leagueId).catch(() => null),
		getSeasonChain(params.leagueId).catch(() => []),
	]);

	return {
		leagueId: params.leagueId,
		analytics: data,
		seasons,
		loadFailed: data === null,
	};
};
