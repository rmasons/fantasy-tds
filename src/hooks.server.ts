import type { Handle } from '@sveltejs/kit';
import { SESSION_COOKIE, verifySessionCookie } from '$lib/server/session';
import { getUserProfileCached } from '$lib/server/user';

// The session cookie is still verified (with revocation check) on every request;
// only the follow-up Firestore profile read is cached briefly (see user.ts).
export const handle: Handle = async ({ event, resolve }) => {
	const sessionCookie = event.cookies.get(SESSION_COOKIE);

	if (sessionCookie) {
		const decoded = await verifySessionCookie(sessionCookie);
		if (decoded) {
			const user = await getUserProfileCached(decoded.uid);
			if (user) {
				event.locals.user = user;
			} else {
				event.locals.user = null;
				event.cookies.delete(SESSION_COOKIE, { path: '/' });
			}
		} else {
			event.locals.user = null;
			event.cookies.delete(SESSION_COOKIE, { path: '/' });
		}
	} else {
		event.locals.user = null;
	}

	return resolve(event);
};
