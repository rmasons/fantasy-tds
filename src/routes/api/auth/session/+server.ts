import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { SESSION_COOKIE, createSessionCookie, SESSION_DURATION_MS } from '$lib/server/session';
import { adminAuth } from '$lib/firebase/admin';
import { upsertUserProfile } from '$lib/server/user';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const { idToken } = await request.json();

	if (!idToken) {
		return json({ error: 'Missing idToken' }, { status: 400 });
	}

	let decoded;
	try {
		decoded = await adminAuth.verifyIdToken(idToken);
	} catch {
		return json({ error: 'Invalid or expired token' }, { status: 401 });
	}

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
		maxAge: SESSION_DURATION_MS / 1000
	});

	return json({ status: 'ok' });
};

export const DELETE: RequestHandler = async ({ cookies }) => {
	cookies.delete(SESSION_COOKIE, { path: '/' });
	return json({ status: 'ok' });
};
