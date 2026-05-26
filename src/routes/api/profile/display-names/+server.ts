import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';

export const GET: RequestHandler = async ({ url }) => {
	const raw = url.searchParams.get('userIds') ?? '';
	const userIds = raw
		.split(',')
		.map(s => s.trim())
		.filter(s => /^\w{1,40}$/.test(s))
		.slice(0, 50);

	if (!userIds.length) return json({ overrides: {} });

	const profiles = await getManagerProfilesBatch(userIds);

	const overrides: Record<string, string> = {};
	for (const [userId, profile] of profiles) {
		if (profile.displayName) overrides[userId] = profile.displayName;
	}

	return json({ overrides });
};
