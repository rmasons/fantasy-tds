import type { PageServerLoad } from './$types';
import { getManagerOptions } from '$lib/server/rivalry';

export const load: PageServerLoad = async ({ params }) => {
	const managers = await getManagerOptions(params.leagueId).catch(() => null);
	return {
		managers: managers ?? [],
		loadFailed: managers === null,
	};
};
