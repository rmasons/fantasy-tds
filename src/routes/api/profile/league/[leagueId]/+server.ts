import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { upsertManagerLeagueProfile } from '$lib/server/managerProfile';

export const PUT: RequestHandler = async ({ request, locals, params }) => {
	if (!locals.user?.sleeperUserId) throw error(401, 'Not authenticated');

	const body = await request.json();

	const joinedYear =
		typeof body.joinedYear === 'number'
			? body.joinedYear
			: body.joinedYear
				? parseInt(body.joinedYear, 10)
				: undefined;

	if (joinedYear !== undefined && (isNaN(joinedYear) || joinedYear < 1990 || joinedYear > 2100)) {
		throw error(400, 'Invalid joinedYear');
	}

	await upsertManagerLeagueProfile(locals.user.sleeperUserId, params.leagueId, {
		joinedYear: joinedYear || undefined,
	});

	return json({ ok: true });
}
