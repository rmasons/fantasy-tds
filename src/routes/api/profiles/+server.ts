import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getManagerProfilesBatch, redactManagerProfile } from '$lib/server/managerProfile';
import { getLeagueMemberIds } from '$lib/server/membership';
import { validateLeagueId } from '$lib/server/leagueId';
import type { ManagerProfile } from '$lib/types';

export const GET: RequestHandler = async ({ url, locals }) => {
	const raw = url.searchParams.get('ids') ?? '';
	const ids = raw
		.split(',')
		.map((s: string) => s.trim())
		.filter(Boolean)
		.slice(0, 50); // cap to prevent abuse

	if (ids.length === 0) throw error(400, 'ids param required');

	const profileMap = await getManagerProfilesBatch(ids);

	// Private fields are exposed only to an authenticated member of the shared
	// league (admins always). Everyone else gets the public subset.
	const isAdmin = !!locals.user?.isAdmin;
	let memberIds: Set<string> | null = null;
	const leagueIdParam = url.searchParams.get('leagueId');
	if (!isAdmin && leagueIdParam && locals.user?.sleeperUserId) {
		try {
			const ms = await getLeagueMemberIds(validateLeagueId(leagueIdParam));
			if (ms.has(locals.user.sleeperUserId)) memberIds = ms;
		} catch {
			// fetch failed — treat requester as non-member
		}
	}

	const out: Record<string, ManagerProfile> = {};
	for (const [id, profile] of profileMap) {
		const canSeePrivate = isAdmin || (memberIds?.has(id) ?? false);
		out[id] = canSeePrivate ? profile : redactManagerProfile(profile);
	}
	return json(out);
};
