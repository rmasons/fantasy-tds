import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getManagerProfilesBatch } from '$lib/server/managerProfile';

export const GET: RequestHandler = async ({ url }) => {
	const raw = url.searchParams.get('ids') ?? '';
	const ids = raw
		.split(',')
		.map((s: string) => s.trim())
		.filter(Boolean)
		.slice(0, 50); // cap to prevent abuse

	if (ids.length === 0) throw error(400, 'ids param required');

	const profileMap = await getManagerProfilesBatch(ids);
	return json(Object.fromEntries(profileMap));
}
