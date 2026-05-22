import type { Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, verifySessionCookie } from '$lib/server/session';
import { getUserProfile } from '$lib/server/user';

export const handle: Handle = async ({ event, resolve }) => {
	const sessionCookie = event.cookies.get(SESSION_COOKIE);

	if (sessionCookie) {
		const decoded = await verifySessionCookie(sessionCookie);
		if (decoded) {
			event.locals.user = await getUserProfile(decoded.uid);
		} else {
			event.locals.user = null;
			event.cookies.delete(SESSION_COOKIE, { path: '/' });
		}
	} else {
		event.locals.user = null;
	}

	return resolve(event);
};
