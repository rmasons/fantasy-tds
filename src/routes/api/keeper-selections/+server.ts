import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getKeeperSelections,
	setKeeperSelection,
	clearKeeperSelection,
} from '$lib/server/keepers';

function validateLeagueId(id: string | null): string {
	if (!id) throw error(400, 'Missing leagueId');
	if (!/^[\w-]+$/.test(id)) throw error(400, 'Invalid leagueId');
	return id;
}

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const leagueId = validateLeagueId(url.searchParams.get('leagueId'));
	const selections = await getKeeperSelections(leagueId);
	return json({ selections });
};

export const PUT: RequestHandler = async ({ url, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const ownerUserId = locals.user.sleeperUserId;
	if (!ownerUserId) throw error(400, 'Sleeper account not linked');

	const leagueId = validateLeagueId(url.searchParams.get('leagueId'));
	const body = await request.json().catch(() => null);

	if (!body || typeof body.rosterId !== 'number') throw error(400, 'Missing rosterId');
	if (
		!Array.isArray(body.playerIds) ||
		body.playerIds.some((id: unknown) => typeof id !== 'string' || !/^\w{1,30}$/.test(id))
	) {
		throw error(400, 'Invalid playerIds');
	}

	const selection = await setKeeperSelection(leagueId, ownerUserId, body.rosterId, body.playerIds);
	return json({ ok: true, selection });
};

export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const leagueId = validateLeagueId(url.searchParams.get('leagueId'));

	let ownerUserId: string;
	if (locals.user.isAdmin && url.searchParams.get('userId')) {
		ownerUserId = url.searchParams.get('userId')!;
	} else {
		ownerUserId = locals.user.sleeperUserId ?? '';
	}
	if (!ownerUserId) throw error(400, 'No userId to clear');

	await clearKeeperSelection(leagueId, ownerUserId);
	return json({ ok: true });
};
