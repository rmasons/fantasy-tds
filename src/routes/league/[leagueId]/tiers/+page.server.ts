import type { PageServerLoad } from './$types';
import { getLeagueConfig } from '$lib/server/config';
import { getSeasonPromotionPoints, getTierProjection } from '$lib/server/promotionPoints';
import { getSeasonChain } from '$lib/server/standings';
import { fetchRosters, fetchUsers, buildRosterInfoMap } from '$lib/sleeper';

export const load: PageServerLoad = async ({ params }) => {
	const cfg = await getLeagueConfig(params.leagueId);
	if (cfg.ruleset !== 'premier') {
		return { isPremier: false, leagueId: params.leagueId };
	}

	// getTierProjection needs the season walk, so compute it once and hand it
	// over rather than letting both calls run it — cachedFetch has no in-flight
	// dedup, so two concurrent cold-cache calls would each fetch every week.
	const [seasonPP, rosters, users, seasons] = await Promise.all([
		getSeasonPromotionPoints(params.leagueId).catch(() => null),
		fetchRosters(params.leagueId).catch(() => []),
		fetchUsers(params.leagueId).catch(() => []),
		getSeasonChain(params.leagueId).catch(() => []),
	]);
	const projection = seasonPP ? await getTierProjection(params.leagueId, seasonPP).catch(() => null) : null;

	const infoMap = buildRosterInfoMap(rosters, users);
	const teamOf = (rosterId: number) => {
		const info = infoMap.get(rosterId);
		return { teamName: info?.teamName ?? `Roster ${rosterId}`, avatar: info?.avatar ?? null };
	};

	return {
		isPremier: true,
		leagueId: params.leagueId,
		season: seasonPP?.season ?? '',
		status: seasonPP?.status ?? '',
		regularSeasonEndWeek: seasonPP?.regularSeasonEndWeek ?? 14,
		standings: (seasonPP?.standings ?? []).map((s) => ({ ...s, ...teamOf(s.rosterId) })),
		breakdown: seasonPP?.breakdown ?? [],
		manualLedger: (seasonPP?.manualLedger ?? []).map((t) => ({ ...t, ...teamOf(Number(t.rosterId)) })),
		playIns: (projection?.playIns ?? []).map((m) => ({
			...m,
			challenger: { ...m.challenger, ...teamOf(m.challenger.rosterId) },
			incumbent: { ...m.incumbent, ...teamOf(m.incumbent.rosterId) },
		})),
		movements: (projection?.movements ?? []).map((m) => ({ ...m, ...teamOf(m.rosterId) })),
		seasons,
		loadFailed: seasonPP === null,
		/** Set when the season walk succeeded but the projection didn't — the
		 *  play-in/movement section is unavailable rather than empty-because-settled. */
		projectionFailed: seasonPP !== null && projection === null,
		incompleteTiers: projection?.incompleteTiers ?? [],
	};
};
