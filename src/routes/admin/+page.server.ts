import type { PageServerLoad } from './$types';
import { getAllLeagueConfigs, getAppConfig } from '$lib/server/config';

export const load: PageServerLoad = async () => {
	const [leagueConfigs, appConfig] = await Promise.all([
		getAllLeagueConfigs(),
		getAppConfig(),
	]);
	return { leagueConfigs, appConfig };
};
