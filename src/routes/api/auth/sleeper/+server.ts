import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { upsertUserProfile, getUidBySleeperId } from '$lib/server/user';
import { upsertManagerProfile } from '$lib/server/managerProfile';
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

	const existingUid = await getUidBySleeperId(sleeperUser.user_id);
	if (existingUid && existingUid !== locals.user.uid) {
		return json({ error: 'This Sleeper account is already linked to another user.' }, { status: 409 });
	}

	await upsertUserProfile(locals.user.uid, {
		sleeperUserId: sleeperUser.user_id,
		sleeperUsername: sleeperUser.username
	});

	// Merge email into the manager profile (won't overwrite fields set by commissioner)
	if (locals.user.email) {
		await upsertManagerProfile(sleeperUser.user_id, { email: locals.user.email });
	}

	return json({ sleeperUser });
};
