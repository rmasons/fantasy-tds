import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getLeagueConfig, setLeagueConfig, deleteLeagueConfig } from '$lib/server/config';
import { fetchRosters, fetchUsers, buildRosterInfoMap } from '$lib/sleeper';

const VALID_NAV_ITEMS = new Set([
	'standings', 'matchups', 'power-rankings', 'rosters', 'records',
	'transactions', 'drafts', 'awards', 'managers', 'rivalry', 'keepers', 'superlatives', 'blog',
]);

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user?.isAdmin) throw redirect(303, `/league/${params.leagueId}`);

	const [cfg, rosters, users] = await Promise.all([
		getLeagueConfig(params.leagueId),
		fetchRosters(params.leagueId).catch(() => []),
		fetchUsers(params.leagueId).catch(() => []),
	]);

	const infoMap = buildRosterInfoMap(rosters, users);
	const rosterList = rosters
		.map((r: any) => ({
			rosterId: String(r.roster_id),
			teamName: infoMap.get(r.roster_id)?.teamName ?? `Roster ${r.roster_id}`,
		}))
		.sort((a: any, b: any) => a.teamName.localeCompare(b.teamName));

	return {
		user: locals.user,
		rosterList,
		faabBonuses: cfg.faabBonuses ?? {},
		leagueConfig: {
			contentfulSpaceId: cfg.contentfulSpaceId,
			hasAccessToken: !!cfg.contentfulAccessToken,
			hasManagementToken: !!cfg.contentfulManagementToken,
			enabledNavItems: cfg.enabledNavItems,
		},
	};
};

export const actions: Actions = {
	saveConfig: async ({ request, params, locals }) => {
		if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
		const data = await request.formData();

		const navRaw = (data.get('enabledNavItems') as string)?.trim();
		const enabledNavItems = navRaw
			? navRaw.split(',').filter(item => VALID_NAV_ITEMS.has(item))
			: undefined;

		const update: Parameters<typeof setLeagueConfig>[1] = { enabledNavItems };

		// Only update Contentful fields when explicitly provided — never delete on blank
		const contentfulSpaceId = (data.get('contentfulSpaceId') as string)?.trim();
		if (contentfulSpaceId) update.contentfulSpaceId = contentfulSpaceId;

		const accessToken = (data.get('contentfulAccessToken') as string)?.trim();
		if (accessToken) update.contentfulAccessToken = accessToken;

		const mgmtToken = (data.get('contentfulManagementToken') as string)?.trim();
		if (mgmtToken) update.contentfulManagementToken = mgmtToken;

		await setLeagueConfig(params.leagueId, update);
		return { configSuccess: true };
	},

	saveFaabBonuses: async ({ request, params, locals }) => {
		if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
		const data = await request.formData();
		const bonuses: Record<string, number> = {};
		for (const [key, val] of data.entries()) {
			if (!key.startsWith('faab_')) continue;
			const rosterId = key.slice(5);
			const amount = parseInt(val as string, 10);
			if (!isNaN(amount) && amount > 0) bonuses[rosterId] = amount;
		}
		await setLeagueConfig(params.leagueId, { faabBonuses: bonuses });
		return { faabSuccess: true };
	},

	deleteConfig: async ({ params, locals }) => {
		if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
		await deleteLeagueConfig(params.leagueId);
		throw redirect(303, `/league/${params.leagueId}`);
	},
};
