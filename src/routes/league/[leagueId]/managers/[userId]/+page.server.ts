import type { PageServerLoad } from './$types';
import { getManagerCareer } from '$lib/server/managerCareer';

export const load: PageServerLoad = async ({ params, locals }) => {
	const career = await getManagerCareer(params.leagueId, params.userId).catch(() => null);
	return {
		userId: params.userId,
		isAdmin: !!(locals.user?.isAdmin),
		manager: career?.manager ?? null,
		seasons: career?.seasons ?? [],
		loadFailed: career === null,
	};
};
