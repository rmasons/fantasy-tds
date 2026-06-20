import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminDb } from '$lib/firebase/admin';
import { validateLeagueId } from '$lib/server/leagueId';
import { assertLeagueMember } from '$lib/server/membership';
import { EGG_IDS, MAX_CLAIMS_PER_USER } from '$lib/eggs';

// Re-export so existing importers (FaabEasterEgg component) keep working.
export type { EggClaim } from '$lib/eggs';
import type { EggClaim } from '$lib/eggs';

// GET — public; returns all claimed eggs for this league
export const GET: RequestHandler = async ({ params }) => {
	const leagueId = validateLeagueId(params.leagueId);
	const doc = await adminDb().collection('faabEggs').doc(leagueId).get();
	return json(doc.exists ? (doc.data() as Record<string, EggClaim>) : {});
};

// POST — claim an egg; first-come, first-served via Firestore transaction
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) throw error(401, 'Sign in to claim FAAB eggs');

	const body = await request.json().catch(() => null);
	const eggId = typeof body?.eggId === 'string' ? body.eggId : null;
	if (!eggId || !EGG_IDS.has(eggId)) throw error(400, 'Invalid eggId');

	const leagueId = validateLeagueId(params.leagueId);
	await assertLeagueMember(locals.user, leagueId);
	const docRef = adminDb().collection('faabEggs').doc(leagueId);
	const uid = locals.user.sleeperUserId ?? locals.user.uid;

	const claim: EggClaim = {
		claimedBy: uid,
		displayName: locals.user.sleeperUsername ?? locals.user.email ?? 'Someone',
		claimedAt: new Date().toISOString(),
	};

	let won = false;
	let existingClaim: EggClaim | null = null;

	await adminDb().runTransaction(async (tx) => {
		const snap = await tx.get(docRef);
		const data = (snap.exists ? snap.data() : {}) as Record<string, EggClaim>;

		if (data[eggId]) {
			existingClaim = data[eggId];
			return;
		}

		const userClaimCount = Object.values(data).filter(c => c.claimedBy === uid).length;
		if (userClaimCount >= MAX_CLAIMS_PER_USER) {
			existingClaim = { claimedBy: uid, displayName: 'you', claimedAt: '' };
			return;
		}

		tx.set(docRef, { [eggId]: claim }, { merge: true });
		won = true;
	});

	const ec = existingClaim as EggClaim | null;
	if (!won && ec !== null && ec.claimedBy === uid && ec.claimedAt === '') {
		throw error(409, 'Claim limit reached');
	}

	return json({ won, claim: won ? claim : existingClaim }, { status: won ? 201 : 200 });
};
