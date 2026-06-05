import type { PageServerLoad } from './$types';
import { getManagers } from '$lib/server/managers';

export const load: PageServerLoad = async ({ params }) => {
	const managers = await getManagers(params.leagueId).catch(() => null);
	return {
		managers: managers ?? [],
		loadFailed: managers === null,
	};
};
