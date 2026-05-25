import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminDb } from '$lib/firebase/admin';

export interface EggClaim {
	claimedBy: string;
	displayName: string;
	claimedAt: string;
}

// GET — public; returns all claimed eggs for this league
export const GET: RequestHandler = async ({ params }) => {
	const doc = await adminDb.collection('faabEggs').doc(params.leagueId).get();
	return json(doc.exists ? (doc.data() as Record<string, EggClaim>) : {});
};

// POST — claim an egg; first-come, first-served via Firestore transaction
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Sign in to claim FAAB eggs');

	const body = await request.json().catch(() => null);
	const eggId = typeof body?.eggId === 'string' ? body.eggId : null;
	if (!eggId) throw error(400, 'Missing eggId');

	const { leagueId } = params;
	const docRef = adminDb.collection('faabEggs').doc(leagueId);

	const claim: EggClaim = {
		claimedBy: locals.user.sleeperUserId ?? locals.user.uid,
		displayName: locals.user.sleeperUsername ?? locals.user.email ?? 'Someone',
		claimedAt: new Date().toISOString(),
	};

	let won = false;
	let existingClaim: EggClaim | null = null;

	await adminDb.runTransaction(async (tx) => {
		const snap = await tx.get(docRef);
		const data = (snap.exists ? snap.data() : {}) as Record<string, EggClaim>;

		if (data[eggId]) {
			existingClaim = data[eggId];
		} else {
			tx.set(docRef, { [eggId]: claim }, { merge: true });
			won = true;
		}
	});

	return json({ won, claim: won ? claim : existingClaim }, { status: won ? 201 : 200 });
};
