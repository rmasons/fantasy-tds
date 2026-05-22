import type { LayoutServerLoad } from './$types';
import { adminDb } from '$lib/firebase/admin';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	// Persist last-viewed league for logged-in users
	if (locals.user && locals.user.lastLeagueId !== params.leagueId) {
		await adminDb
			.collection('users')
			.doc(locals.user.uid)
			.set({ lastLeagueId: params.leagueId }, { merge: true });
	}

	return {
		user: locals.user,
		leagueId: params.leagueId
	};
};
