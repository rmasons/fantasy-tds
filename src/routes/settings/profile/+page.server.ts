import { redirect, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getManagerProfile, getManagerLeagueProfile, upsertManagerProfile, upsertManagerLeagueProfile, PROFILE_MAX_LENGTHS } from '$lib/server/managerProfile';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) throw redirect(302, '/login');

	const leagueId = url.searchParams.get('leagueId');

	const [globalProfile, leagueProfile] = await Promise.all([
		locals.user.sleeperUserId ? getManagerProfile(locals.user.sleeperUserId) : null,
		locals.user.sleeperUserId && leagueId
			? getManagerLeagueProfile(locals.user.sleeperUserId, leagueId)
			: null,
	]);

	return {
		user: locals.user,
		globalProfile,
		leagueProfile,
		leagueId,
	};
};

export const actions: Actions = {
	saveGlobal: async ({ request, locals }) => {
		if (!locals.user?.sleeperUserId) return fail(401, { error: 'Not authenticated' });

		const data = await request.formData();

		const update: Record<string, string | undefined> = {};
		for (const [key, max] of Object.entries(PROFILE_MAX_LENGTHS)) {
			const raw = (data.get(key) as string | null)?.trim() ?? '';
			if (raw.length > max) return fail(400, { error: `${key} exceeds ${max} characters` });
			update[key] = key === 'twitterHandle' ? raw.replace(/^@/, '') || undefined : raw || undefined;
		}

		await upsertManagerProfile(locals.user.sleeperUserId, update);
		return { success: true, section: 'global' };
	},

	saveLeague: async ({ request, locals, url }) => {
		if (!locals.user?.sleeperUserId) return fail(401, { error: 'Not authenticated' });

		const leagueId = url.searchParams.get('leagueId');
		if (!leagueId) return fail(400, { error: 'No league specified' });

		const data = await request.formData();
		const rawYear = (data.get('joinedYear') as string | null)?.trim() ?? '';
		const joinedYear = rawYear ? parseInt(rawYear, 10) : undefined;

		if (joinedYear !== undefined && (isNaN(joinedYear) || joinedYear < 1990 || joinedYear > 2100)) {
			return fail(400, { error: 'Invalid year' });
		}

		await upsertManagerLeagueProfile(locals.user.sleeperUserId, leagueId, {
			joinedYear: joinedYear || undefined,
		});

		return { success: true, section: 'league' };
	},
};
