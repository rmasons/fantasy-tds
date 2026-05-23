import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getLeagueConfig, setLeagueConfig, deleteLeagueConfig } from '$lib/server/config';

const VALID_NAV_ITEMS = new Set([
	'standings', 'matchups', 'power-rankings', 'rosters', 'records',
	'transactions', 'drafts', 'awards', 'managers', 'rivalry', 'blog',
]);

function assertValidLeagueId(id: string) {
	if (!/^[\w-]+$/.test(id)) throw error(400, 'Invalid league ID.');
}

export const load: PageServerLoad = async ({ params }) => {
	assertValidLeagueId(params.leagueId);
	const cfg = await getLeagueConfig(params.leagueId);
	return {
		leagueId: params.leagueId,
		leagueConfig: {
			contentfulSpaceId: cfg.contentfulSpaceId,
			hasAccessToken: !!cfg.contentfulAccessToken,
			hasManagementToken: !!cfg.contentfulManagementToken,
			enabledNavItems: cfg.enabledNavItems,
		},
	};
};

export const actions: Actions = {
	save: async ({ request, params, locals }) => {
		if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
		assertValidLeagueId(params.leagueId);
		const data = await request.formData();

		const contentfulSpaceId = (data.get('contentfulSpaceId') as string)?.trim() || undefined;
		const navRaw = (data.get('enabledNavItems') as string)?.trim();
		const enabledNavItems = navRaw
			? navRaw.split(',').filter(item => VALID_NAV_ITEMS.has(item))
			: undefined;

		const update: Parameters<typeof setLeagueConfig>[1] = { contentfulSpaceId, enabledNavItems };

		// Only overwrite tokens when a new value is explicitly submitted; blank = keep existing
		const accessToken = (data.get('contentfulAccessToken') as string)?.trim();
		if (accessToken) update.contentfulAccessToken = accessToken;

		const mgmtToken = (data.get('contentfulManagementToken') as string)?.trim();
		if (mgmtToken) update.contentfulManagementToken = mgmtToken;

		await setLeagueConfig(params.leagueId, update);
		return { success: true };
	},

	delete: async ({ params, locals }) => {
		if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
		assertValidLeagueId(params.leagueId);
		await deleteLeagueConfig(params.leagueId);
		throw redirect(303, '/admin');
	},
};
