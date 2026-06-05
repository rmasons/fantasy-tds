import type { LayoutServerLoad } from './$types';
import { adminDb } from '$lib/firebase/admin';
import { getLeagueConfig } from '$lib/server/config';
import { fetchLeague } from '$lib/sleeper';

export const load: LayoutServerLoad = async ({ locals, params }) => {
	const [leagueConfig, league] = await Promise.all([
		getLeagueConfig(params.leagueId),
		fetchLeague(params.leagueId).catch(() => null),
		// Persist last-viewed league for logged-in users
		locals.user && locals.user.lastLeagueId !== params.leagueId
			? adminDb.collection('users').doc(locals.user.uid).set({ lastLeagueId: params.leagueId }, { merge: true })
			: Promise.resolve(),
	]);

	return {
		user: locals.user,
		leagueId: params.leagueId,
		leagueName: league?.name ?? null,
		leagueAvatar: league?.avatar ? `https://sleepercdn.com/avatars/${league.avatar}` : null,
		hasBlog: !!(leagueConfig.contentfulSpaceId && leagueConfig.contentfulAccessToken),
		enabledNavItems: leagueConfig.enabledNavItems ?? null,
	};
};
