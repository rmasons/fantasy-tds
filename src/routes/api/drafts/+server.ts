import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCachedDraftList, getCachedDraftPicks, seedLeagueChain } from '$lib/server/drafts';

function validateParam(id: string | null, name: string): string {
	if (!id) throw error(400, `Missing ${name}`);
	if (!/^[\w-]+$/.test(id)) throw error(400, `Invalid ${name}`);
	return id;
}

export const GET: RequestHandler = async ({ url }) => {

	const leagueId = validateParam(url.searchParams.get('leagueId'), 'leagueId');
	const draftId = url.searchParams.get('draftId');

	try {
		const cacheHeader = { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600' } };
		if (draftId) {
			const picks = await getCachedDraftPicks(validateParam(draftId, 'draftId'));
			return json({ picks }, cacheHeader);
		}
		const drafts = await getCachedDraftList(leagueId);
		return json({ drafts }, cacheHeader);
	} catch (e) {
		console.error('[drafts] GET failed:', e);
		throw error(502, 'Failed to load draft data');
	}
};

export const POST: RequestHandler = async ({ url, locals }) => {
	if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
	const leagueId = validateParam(url.searchParams.get('leagueId'), 'leagueId');
	try {
		const results = await seedLeagueChain(leagueId);
		return json({ results });
	} catch (e) {
		console.error('[drafts] seed failed:', e);
		throw error(502, 'Seed failed');
	}
};
