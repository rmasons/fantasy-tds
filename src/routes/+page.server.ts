import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getAppConfig } from '$lib/server/config';
import type { SleeperLeague } from '$lib/types';

export const load: PageServerLoad = async ({ locals, fetch }) => {
	if (!locals.user) {
		const config = await getAppConfig();
		if (config.defaultLeagueId) {
			throw redirect(302, `/league/${config.defaultLeagueId}`);
		}
		throw redirect(302, '/login');
	}

	const sleeperUserId = locals.user.sleeperUserId;
	if (!sleeperUserId) return { user: locals.user, leagues: null };

	let season: string;
	try {
		const res = await fetch('https://api.sleeper.app/v1/state/nfl');
		const state = res.ok ? await res.json() : null;
		season = state?.season ?? String(new Date().getFullYear());
	} catch {
		season = String(new Date().getFullYear());
	}

	let leagues: SleeperLeague[] = [];
	try {
		const res = await fetch(`https://api.sleeper.app/v1/user/${sleeperUserId}/leagues/nfl/${season}`);
		leagues = res.ok ? await res.json() : [];
	} catch {
		leagues = [];
	}

	// Only one league — skip the picker.
	if (leagues.length === 1) throw redirect(302, `/league/${leagues[0].league_id}`);

	return { user: locals.user, leagues };
};
