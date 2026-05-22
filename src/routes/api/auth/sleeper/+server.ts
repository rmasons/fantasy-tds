import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { upsertUserProfile } from '$lib/server/user';
import type { SleeperUser } from '$lib/types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const { username } = await request.json();
	const trimmed = username?.trim() ?? '';
	if (!trimmed) {
		return json({ error: 'Username required' }, { status: 400 });
	}
	if (!/^[a-zA-Z0-9_]{1,30}$/.test(trimmed)) {
		return json({ error: 'Invalid username format' }, { status: 400 });
	}

	const res = await fetch(`https://api.sleeper.app/v1/user/${trimmed}`);
	if (!res.ok) {
		return json({ error: 'Sleeper user not found' }, { status: 404 });
	}

	const sleeperUser: SleeperUser = await res.json();

	await upsertUserProfile(locals.user.uid, {
		sleeperUserId: sleeperUser.user_id,
		sleeperUsername: sleeperUser.username
	});

	return json({ sleeperUser });
};
