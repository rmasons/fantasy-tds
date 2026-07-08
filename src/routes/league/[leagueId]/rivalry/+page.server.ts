import type { PageServerLoad } from './$types';
import { getManagerOptions } from '$lib/server/rivalry';
import { loadRivalryDigest } from '$lib/server/rivalryDigestData';
import type { DigestItem } from '$lib/server/rivalryDigest';

export const load: PageServerLoad = async ({ params }) => {
	const [managers, digestResult] = await Promise.all([
		getManagerOptions(params.leagueId).catch(() => null),
		loadRivalryDigest(params.leagueId).catch(() => null),
	]);

	return {
		managers: managers ?? [],
		loadFailed: managers === null,
		digestWeek: digestResult?.week ?? null,
		digest: (digestResult?.digest ?? []) as DigestItem[],
	};
};
