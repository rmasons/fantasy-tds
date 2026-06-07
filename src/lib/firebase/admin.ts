import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { FIREBASE_SERVICE_ACCOUNT } from '$env/static/private';

let _app: App | null = null;
let _auth: Auth | null = null;
let _db: Firestore | null = null;

function adminApp(): App {
	if (_app) return _app;
	if (getApps().length) {
		_app = getApps()[0];
		return _app;
	}
	let serviceAccount: object;
	try {
		serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
	} catch (e) {
		throw new Error(
			'FIREBASE_SERVICE_ACCOUNT in .env is not valid JSON. ' +
			'Paste the raw JSON on a single line with no surrounding quotes. ' +
			`Parse error: ${(e as Error).message}`
		);
	}
	_app = initializeApp({ credential: cert(serviceAccount) });
	return _app;
}

/** Lazily-initialized, memoized Firebase Admin Auth instance. */
export function adminAuth(): Auth {
	return (_auth ??= getAuth(adminApp()));
}

/** Lazily-initialized, memoized Firestore instance. */
export function adminDb(): Firestore {
	return (_db ??= getFirestore(adminApp()));
}

