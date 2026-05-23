import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCachedDraftList, getCachedDraftPicks } from '$lib/server/drafts';

function validateParam(id: string | null, name: string): string {
	if (!id) throw error(400, `Missing ${name}`);
	if (!/^[\w-]+$/.test(id)) throw error(400, `Invalid ${name}`);
	return id;
}

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const leagueId = validateParam(url.searchParams.get('leagueId'), 'leagueId');
	const draftId = url.searchParams.get('draftId');

	try {
		if (draftId) {
			const picks = await getCachedDraftPicks(validateParam(draftId, 'draftId'));
			return json({ picks });
		}
		const drafts = await getCachedDraftList(leagueId);
		return json({ drafts });
	} catch (e) {
		console.error('[drafts] GET failed:', e);
		throw error(502, 'Failed to load draft data');
	}
};
