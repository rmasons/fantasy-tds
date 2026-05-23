import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user?.isAdmin) throw redirect(303, `/league/${params.leagueId}`);
	return { user: locals.user };
};
