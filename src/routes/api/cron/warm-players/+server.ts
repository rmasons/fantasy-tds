import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { getPlayers } from '$lib/server/players';

// Daily warming job: regenerates today's NFL players snapshot in Vercel Blob
// (and prunes stale snapshots) so the first real visitor of the day doesn't eat
// a cold Sleeper fetch. Wired via the `crons` block in vercel.json.
//
// Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on cron
// invocations; we reject anything else so the endpoint can't be triggered
// publicly. CRON_SECRET is injected by Vercel in production — set it locally to
// test.
export const GET: RequestHandler = async ({ request }) => {
	const secret = env.CRON_SECRET;
	if (secret) {
		const auth = request.headers.get('authorization');
		if (auth !== `Bearer ${secret}`) throw error(401, 'Unauthorized');
	}

	const players = await getPlayers();
	return json({ ok: true, count: Object.keys(players).length, time: new Date().toISOString() });
};
