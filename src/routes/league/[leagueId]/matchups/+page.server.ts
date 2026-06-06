import type { PageServerLoad } from './$types';
import { getMatchupsMeta } from '$lib/server/matchups';
import { getCachedMatchups } from '$lib/server/sleeperCache';
import { getSeasonChain } from '$lib/server/standings';

export const load: PageServerLoad = async ({ params }) => {
	const [meta, seasons] = await Promise.all([
		getMatchupsMeta(params.leagueId).catch(() => null),
		getSeasonChain(params.leagueId).catch(() => []),
	]);

	// Ship the current week's raw matchups for immediate render; the client
	// groups them and lazy-loads other weeks from the API.
	let currentWeekRaw: Awaited<ReturnType<typeof getCachedMatchups>> = [];
	if (meta && meta.currentWeek >= 1) {
		const live = meta.status !== 'complete'; // the current week is live unless the season is complete
		currentWeekRaw = await getCachedMatchups(params.leagueId, meta.currentWeek, live).catch(() => []);
	}

	return {
		meta,
		currentWeekRaw,
		seasons,
		loadFailed: meta === null,
	};
};
