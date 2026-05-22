import type { LayoutServerLoad } from './$types';
import { adminDb } from '$lib/firebase/admin';
import { getLeagueConfig } from '$lib/server/config';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	const [leagueConfig] = await Promise.all([
		getLeagueConfig(params.leagueId),
		// Persist last-viewed league for logged-in users
		locals.user && locals.user.lastLeagueId !== params.leagueId
			? adminDb.collection('users').doc(locals.user.uid).set({ lastLeagueId: params.leagueId }, { merge: true })
			: Promise.resolve(),
	]);

	return {
		user: locals.user,
		leagueId: params.leagueId,
		hasBlog: !!(leagueConfig.contentfulSpaceId && leagueConfig.contentfulAccessToken),
		enabledNavItems: leagueConfig.enabledNavItems ?? null,
	};
};
