import type { PageServerLoad, Actions } from './$types';
import { getAppConfig, setAppConfig } from '$lib/server/config';

export const load: PageServerLoad = async () => {
	const appConfig = await getAppConfig();
	return { appConfig };
};

export const actions: Actions = {
	default: async ({ request }) => {
		const data = await request.formData();
		const defaultLeagueId = (data.get('defaultLeagueId') as string)?.trim() || undefined;
		await setAppConfig({ defaultLeagueId });
		return { success: true };
	},
};
