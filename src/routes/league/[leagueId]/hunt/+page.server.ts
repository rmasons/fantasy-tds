import type { PageServerLoad } from './$types';
import { adminDb } from '$lib/firebase/admin';
import { validateLeagueId } from '$lib/server/leagueId';
import type { EggClaim } from '$lib/eggs';

// Public leaderboard for the FAAB easter-egg hunt. Reads the same Firestore
// doc the claim API writes to; no auth required (matches the public GET).
export const load: PageServerLoad = async ({ params, locals }) => {
	const leagueId = validateLeagueId(params.leagueId);

	let claims: Record<string, EggClaim> = {};
	try {
		const doc = await adminDb().collection('faabEggs').doc(leagueId).get();
		if (doc.exists) claims = doc.data() as Record<string, EggClaim>;
	} catch (e) {
		console.error('[hunt] failed to read egg claims for', leagueId, e);
	}

	// The id the claim API stamps onto a claim, so the page can highlight "you".
	const myId = locals.user ? (locals.user.sleeperUserId ?? locals.user.uid) : null;

	return { claims, myId };
};
