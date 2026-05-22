import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getAppConfig } from '$lib/server/config';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) {
		const config = await getAppConfig();
		if (config.defaultLeagueId) {
			throw redirect(302, `/league/${config.defaultLeagueId}`);
		}
		throw redirect(302, '/login');
	}
	return { user: locals.user };
};
