import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getKeeperData,
	setPlayerOverride,
	resetPlayerOverride,
	importPlayers,
	invalidateDraftCache,
} from '$lib/server/keepers';

function validateLeagueId(id: string | null): string {
	if (!id) throw error(400, 'Missing leagueId');
	if (!/^[\w-]+$/.test(id)) throw error(400, 'Invalid leagueId');
	return id;
}

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const leagueId = validateLeagueId(url.searchParams.get('leagueId'));
	try {
		return json(await getKeeperData(leagueId));
	} catch (e) {
		console.error('[keepers] GET failed:', e);
		throw error(502, 'Failed to load keeper data');
	}
};

// Update a single player's yearsKept / baseOverride
export const PATCH: RequestHandler = async ({ url, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const leagueId = validateLeagueId(url.searchParams.get('leagueId'));

	const body = await request.json().catch(() => null);
	if (!body?.playerId) throw error(400, 'Missing playerId');

	const patch: { yearsKept?: number; baseOverride?: number | null } = {};
	if (typeof body.yearsKept === 'number') patch.yearsKept = body.yearsKept;
	if ('baseOverride' in body) patch.baseOverride = body.baseOverride ?? null;
	if (!Object.keys(patch).length) throw error(400, 'Nothing to update');

	await setPlayerOverride(leagueId, body.playerId, patch);
	return json({ ok: true });
};

// Reset a player back to auto-calculated values (used when a player is dropped)
export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const leagueId = validateLeagueId(url.searchParams.get('leagueId'));
	const playerId = url.searchParams.get('playerId');
	if (!playerId) throw error(400, 'Missing playerId');

	await resetPlayerOverride(leagueId, playerId);
	return json({ ok: true });
};

// Bulk import pre-Sleeper keepers
export const POST: RequestHandler = async ({ url, request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	const leagueId = validateLeagueId(url.searchParams.get('leagueId'));

	const body = await request.json().catch(() => null);

	// ?action=invalidate-cache refreshes draft history
	if (url.searchParams.get('action') === 'invalidate-cache') {
		await invalidateDraftCache(leagueId);
		return json({ ok: true });
	}

	if (!Array.isArray(body?.players)) throw error(400, 'Expected { players: [...] }');

	const entries = (body.players as any[]).filter(
		e => typeof e.playerId === 'string' && e.playerId,
	);
	if (!entries.length) throw error(400, 'No valid entries');

	await importPlayers(leagueId, entries);
	return json({ ok: true, imported: entries.length });
};
