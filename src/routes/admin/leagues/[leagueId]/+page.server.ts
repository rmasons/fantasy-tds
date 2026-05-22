import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getLeagueConfig, setLeagueConfig, deleteLeagueConfig } from '$lib/server/config';

export const load: PageServerLoad = async ({ params }) => {
	const leagueConfig = await getLeagueConfig(params.leagueId);
	return { leagueConfig, leagueId: params.leagueId };
};

export const actions: Actions = {
	save: async ({ request, params }) => {
		const data = await request.formData();

		const contentfulSpaceId = (data.get('contentfulSpaceId') as string)?.trim() || undefined;
		const contentfulAccessToken = (data.get('contentfulAccessToken') as string)?.trim() || undefined;
		const contentfulManagementToken = (data.get('contentfulManagementToken') as string)?.trim() || undefined;

		const navRaw = (data.get('enabledNavItems') as string)?.trim();
		const enabledNavItems = navRaw ? navRaw.split(',').filter(Boolean) : undefined;

		await setLeagueConfig(params.leagueId, {
			contentfulSpaceId,
			contentfulAccessToken,
			contentfulManagementToken,
			enabledNavItems,
		});

		return { success: true };
	},

	delete: async ({ params }) => {
		await deleteLeagueConfig(params.leagueId);
		throw redirect(303, '/admin');
	},
};
