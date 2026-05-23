import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { leagueId, user } = await parent();
	return { leagueId, user };
};
