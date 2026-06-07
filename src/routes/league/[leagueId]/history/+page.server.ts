import type { PageServerLoad } from './$types';
import { getHistoryPodiums } from '$lib/server/historyPodiums';

export const load: PageServerLoad = async ({ params }) => {
	const data = await getHistoryPodiums(params.leagueId).catch(() => null);
	return {
		podiums: data?.podiums ?? [],
		seasonLidMap: data?.seasonLidMap ?? {},
		loadFailed: data === null,
	};
};
