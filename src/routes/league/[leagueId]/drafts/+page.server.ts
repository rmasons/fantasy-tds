import type { PageServerLoad } from './$types';
import { getCachedDraftList } from '$lib/server/drafts';
import { getSeasonChain } from '$lib/server/standings';

export const load: PageServerLoad = async ({ params }) => {
	const seasons = await getSeasonChain(params.leagueId).catch(() => []);
	try {
		const { drafts, rosterInfo } = await getCachedDraftList(params.leagueId);
		const completedDrafts = (drafts ?? [])
			.filter((d) => d.status === 'complete')
			.sort((a, b) => parseInt(b.season, 10) - parseInt(a.season, 10));
		return { completedDrafts, rosterInfo, seasons };
	} catch (e) {
		console.error('[drafts] server load failed:', e);
		return { completedDrafts: [], rosterInfo: {}, seasons };
	}
};
