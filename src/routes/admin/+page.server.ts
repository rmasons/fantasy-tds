import { error } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getAllLeagueConfigs, getAppConfig, setLeagueConfig } from '$lib/server/config';
import { fetchRosters, fetchUsers, buildRosterInfoMap } from '$lib/sleeper';

export const load: PageServerLoad = async () => {
	const [leagueConfigs, appConfig] = await Promise.all([
		getAllLeagueConfigs(),
		getAppConfig(),
	]);

	const leagueIds = Object.keys(leagueConfigs);

	const rostersByLeague: Record<string, { rosterId: string; teamName: string }[]> = {};
	await Promise.all(
		leagueIds.map(async (id) => {
			try {
				const [rosters, users] = await Promise.all([fetchRosters(id), fetchUsers(id)]);
				const infoMap = buildRosterInfoMap(rosters, users);
				rostersByLeague[id] = rosters
					.map((r: any) => ({
						rosterId: String(r.roster_id),
						teamName: infoMap.get(r.roster_id)?.teamName ?? `Roster ${r.roster_id}`,
					}))
					.sort((a: any, b: any) => a.teamName.localeCompare(b.teamName));
			} catch {
				rostersByLeague[id] = [];
			}
		})
	);

	return { leagueConfigs, appConfig, rostersByLeague };
};

export const actions: Actions = {
	saveFaabBonuses: async ({ request, locals }) => {
		if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
		const data = await request.formData();
		const leagueId = (data.get('leagueId') as string)?.trim();
		if (!leagueId || !/^[\w-]+$/.test(leagueId)) throw error(400, 'Invalid league ID.');

		const bonuses: Record<string, number> = {};
		for (const [key, val] of data.entries()) {
			if (!key.startsWith('faab_')) continue;
			const rosterId = key.slice(5);
			const amount = parseInt(val as string, 10);
			if (!isNaN(amount) && amount > 0) bonuses[rosterId] = amount;
		}
		await setLeagueConfig(leagueId, { faabBonuses: bonuses });
		return { faabSuccess: true, savedLeagueId: leagueId };
	},
};
