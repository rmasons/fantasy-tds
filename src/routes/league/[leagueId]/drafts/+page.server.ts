import type { PageServerLoad } from './$types';
import { getCachedDraftList } from '$lib/server/drafts';

export const load: PageServerLoad = async ({ params }) => {
	try {
		const { drafts, rosterInfo } = await getCachedDraftList(params.leagueId);
		const completedDrafts = (drafts ?? [])
			.filter((d: any) => d.status === 'complete')
			.sort((a: any, b: any) => parseInt(b.season, 10) - parseInt(a.season, 10));
		return { completedDrafts, rosterInfo };
	} catch (e) {
		console.error('[drafts] server load failed:', e);
		return { completedDrafts: [], rosterInfo: {} };
	}
};
