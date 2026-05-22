import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SESSION_COOKIE, createSessionCookie } from '$lib/server/session';
import { adminAuth } from '$lib/firebase/admin';
import { upsertUserProfile } from '$lib/server/user';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const { idToken } = await request.json();

	if (!idToken) {
		return json({ error: 'Missing idToken' }, { status: 400 });
	}

	const decoded = await adminAuth.verifyIdToken(idToken);
	await upsertUserProfile(decoded.uid, {
		uid: decoded.uid,
		email: decoded.email ?? '',
		sleeperUserId: null,
		sleeperUsername: null,
		lastLeagueId: null
	});

	const sessionCookie = await createSessionCookie(idToken);

	cookies.set(SESSION_COOKIE, sessionCookie, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'strict',
		maxAge: 60 * 60 * 24 * 5
	});

	return json({ status: 'ok' });
};

export const DELETE: RequestHandler = async ({ cookies }) => {
	cookies.delete(SESSION_COOKIE, { path: '/' });
	return json({ status: 'ok' });
};
