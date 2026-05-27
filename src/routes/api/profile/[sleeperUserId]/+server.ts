import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getManagerProfile, getManagerLeagueProfile, upsertManagerProfile, upsertManagerLeagueProfile, PROFILE_MAX_LENGTHS } from '$lib/server/managerProfile';

export const GET: RequestHandler = async ({ params, url }) => {
	const { sleeperUserId } = params;
	if (!/^\d+$/.test(sleeperUserId)) throw error(400, 'Invalid user ID.');
	const leagueId = url.searchParams.get('leagueId');

	const [global, league] = await Promise.all([
		getManagerProfile(sleeperUserId),
		leagueId ? getManagerLeagueProfile(sleeperUserId, leagueId) : Promise.resolve(null),
	]);

	return json({ global, league });
};

export const PUT: RequestHandler = async ({ params, request, locals, url }) => {
	if (!locals.user?.isAdmin) throw error(403, 'Forbidden');

	const { sleeperUserId } = params;
	if (!/^\d+$/.test(sleeperUserId)) throw error(400, 'Invalid user ID.');

	const body = await request.json();
	const update: Record<string, string | undefined> = {};

	for (const [key, max] of Object.entries(PROFILE_MAX_LENGTHS)) {
		if (key in body) {
			const val = typeof body[key] === 'string' ? body[key].trim() : '';
			if (val.length > max) throw error(400, `${key} exceeds ${max} characters`);
			update[key] = val || undefined;
		}
	}

	await upsertManagerProfile(sleeperUserId, update);

	const leagueId = url.searchParams.get('leagueId');
	if (leagueId && 'joinedYear' in body) {
		const rawYear = body.joinedYear ? parseInt(String(body.joinedYear), 10) : undefined;
		if (rawYear !== undefined && (isNaN(rawYear) || rawYear < 1990 || rawYear > 2100)) {
			throw error(400, 'Invalid joinedYear');
		}
		await upsertManagerLeagueProfile(sleeperUserId, leagueId, { joinedYear: rawYear || undefined });
	}

	return json({ ok: true });
};
