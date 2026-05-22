import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { FIREBASE_SERVICE_ACCOUNT } from '$env/static/private';
import { PUBLIC_FIREBASE_STORAGE_BUCKET } from '$env/static/public';

let _app: App | null = null;

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
	_app = initializeApp({
		credential: cert(serviceAccount),
		storageBucket: PUBLIC_FIREBASE_STORAGE_BUCKET
	});
	return _app;
}

export const adminAuth = new Proxy({} as ReturnType<typeof getAuth>, {
	get(_, prop) {
		const instance = getAuth(adminApp());
		const value = (instance as any)[prop];
		return typeof value === 'function' ? value.bind(instance) : value;
	}
});

export const adminDb = new Proxy({} as ReturnType<typeof getFirestore>, {
	get(_, prop) {
		const instance = getFirestore(adminApp());
		const value = (instance as any)[prop];
		return typeof value === 'function' ? value.bind(instance) : value;
	}
});

/** Returns the default Storage bucket. Call as: adminBucket().file(...) */
export function adminBucket() {
	return getStorage(adminApp()).bucket();
}
