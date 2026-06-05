import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { upsertManagerProfile, PROFILE_MAX_LENGTHS } from '$lib/server/managerProfile';
import { checkRateLimit } from '$lib/server/rateLimit';
import type { ManagerProfile } from '$lib/types';

export const PUT: RequestHandler = async ({ request, locals, getClientAddress }) => {
	if (!locals.user?.sleeperUserId) throw error(401, 'Not authenticated');
	if (!(await checkRateLimit(`profile-put:${getClientAddress()}`, 10, 60_000))) {
		return new Response('Too many requests.', { status: 429, headers: { 'Retry-After': '60' } });
	}

	const body = await request.json();
	const update: Partial<Omit<ManagerProfile, 'sleeperUserId' | 'updatedAt'>> = {};

	for (const [key, maxLen] of Object.entries(PROFILE_MAX_LENGTHS)) {
		if (key in body) {
			const val = typeof body[key] === 'string' ? body[key].trim() : '';
			if (val.length > maxLen) throw error(400, `${key} exceeds ${maxLen} characters`);
			(update as any)[key] = val || undefined;
		}
	}

	await upsertManagerProfile(locals.user.sleeperUserId, update);
	return json({ ok: true });
}
