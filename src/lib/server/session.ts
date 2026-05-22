import { adminAuth } from '$lib/firebase/admin';

const SESSION_COOKIE = 'session';
const SESSION_DURATION_MS = 60 * 60 * 24 * 5 * 1000; // 5 days

export async function createSessionCookie(idToken: string): Promise<string> {
	return adminAuth.createSessionCookie(idToken, { expiresIn: SESSION_DURATION_MS });
}

export async function verifySessionCookie(cookie: string) {
	try {
		return await adminAuth.verifySessionCookie(cookie, true);
	} catch {
		return null;
	}
}

export { SESSION_COOKIE };
