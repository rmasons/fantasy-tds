import type { PageServerLoad } from './$types';
import { getTransactions } from '$lib/server/transactions';
import { getSeasonChain } from '$lib/server/standings';

export const load: PageServerLoad = async ({ params }) => {
	const [data, seasons] = await Promise.all([
		getTransactions(params.leagueId).catch(() => null),
		getSeasonChain(params.leagueId).catch(() => []),
	]);

	return {
		transactions: data?.transactions ?? [],
		rosterInfo: data?.rosterInfo ?? [],
		players: data?.players ?? {},
		seasons,
		loadFailed: data === null,
	};
};
