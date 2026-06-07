import { adminDb } from '$lib/firebase/admin';

// Firestore-backed sliding-window limiter. Unlike an in-memory Map this is
// shared across serverless instances, so limits hold no matter which instance
// serves a request. Each key gets one doc holding its recent hit timestamps.

export async function checkRateLimit(key: string, limit = 30, windowMs = 60_000): Promise<boolean> {
	const ref = adminDb().collection('rateLimits').doc(key.replace(/[^\w-]/g, '_'));
	const now = Date.now();

	try {
		return await adminDb().runTransaction(async (tx) => {
			const snap = await tx.get(ref);
			const prev: number[] = snap.exists ? (snap.data()!.timestamps ?? []) : [];
			const kept = prev.filter((t) => now - t < windowMs);

			if (kept.length >= limit) {
				tx.set(ref, { timestamps: kept, expiresAt: now + windowMs });
				return false;
			}

			kept.push(now);
			tx.set(ref, { timestamps: kept, expiresAt: now + windowMs });
			return true;
		});
	} catch {
		// Fail open: a Firestore hiccup shouldn't lock out legitimate traffic.
		return true;
	}
}
