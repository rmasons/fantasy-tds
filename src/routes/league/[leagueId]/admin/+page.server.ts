import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getLeagueConfig, setLeagueConfig } from '$lib/server/config';
import { fetchRosters, fetchUsers, buildRosterInfoMap } from '$lib/sleeper';

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
	};
};

export const actions: Actions = {
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
};
