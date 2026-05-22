import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { upsertManagerProfile } from '$lib/server/managerProfile';
import type { ManagerProfile } from '$lib/types';

const MAX_LENGTHS: Record<string, number> = {
	bio: 280,
	location: 60,
	favoriteNFLTeam: 60,
	favoritePlayer: 60,
	funFact: 200,
	twitterHandle: 50,
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user?.sleeperUserId) throw error(401, 'Not authenticated');

	const body = await request.json();
	const update: Partial<Omit<ManagerProfile, 'sleeperUserId' | 'updatedAt'>> = {};

	for (const [key, maxLen] of Object.entries(MAX_LENGTHS)) {
		if (key in body) {
			const val = typeof body[key] === 'string' ? body[key].trim() : '';
			if (val.length > maxLen) throw error(400, `${key} exceeds ${maxLen} characters`);
			// Strip @ from twitterHandle before storing
			(update as any)[key] = key === 'twitterHandle' ? val.replace(/^@/, '') : val || undefined;
		}
	}

	await upsertManagerProfile(locals.user.sleeperUserId, update);
	return json({ ok: true });
}
