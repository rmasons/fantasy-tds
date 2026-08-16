import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getLeagueConfig, setLeagueConfig, deleteLeagueConfig, type TierBudget, type PromotionTransaction } from '$lib/server/config';
import { getFaabLedger, addFaabTransaction, deleteFaabTransaction } from '$lib/server/faab';
import {
	getPromotionLedger,
	addPromotionTransaction,
	deletePromotionTransaction,
	setSeasonTiers,
	setPremierSettings,
	seedTiersFromSleeper,
	clampRegularSeasonEndWeek,
	DEFAULT_AUCTION_BUDGET,
	DEFAULT_FAAB_BUDGET,
	DEFAULT_TRADE_BUDGET_CAP,
	DEFAULT_REGULAR_SEASON_END_WEEK,
} from '$lib/server/promotionPoints';
import { fetchRosters, fetchUsers, buildRosterInfoMap } from '$lib/sleeper';
import { getCachedLeague } from '$lib/server/sleeperCache';
const VALID_NAV_ITEMS = new Set([
	'standings', 'matchups', 'power-rankings', 'rosters', 'history',
	'transactions', 'trades', 'drafts', 'managers', 'rivalry', 'keepers', 'superlatives', 'faab', 'blog', 'tiers',
]);

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user?.isAdmin) throw redirect(303, `/league/${params.leagueId}`);

	const [cfg, rosters, users, faabLedger, league, promotionLedgerAll] = await Promise.all([
		getLeagueConfig(params.leagueId),
		fetchRosters(params.leagueId).catch(() => []),
		fetchUsers(params.leagueId).catch(() => []),
		getFaabLedger(params.leagueId).catch(() => []),
		getCachedLeague(params.leagueId).catch(() => null),
		getPromotionLedger(params.leagueId).catch(() => []),
	]);

	const infoMap = buildRosterInfoMap(rosters, users);
	const rosterList = rosters
		.map((r: any) => ({
			rosterId: String(r.roster_id),
			teamName: infoMap.get(r.roster_id)?.teamName ?? `Roster ${r.roster_id}`,
		}))
		.sort((a: any, b: any) => a.teamName.localeCompare(b.teamName));

	// A failed league fetch leaves season '' — which would render an empty tier
	// map and an empty ledger, indistinguishable from "nothing is configured".
	// Flag it so the UI can say the season is unavailable instead of implying
	// the config was lost.
	const season = league?.season ?? '';
	const seasonUnavailable = !league?.season;
	const promotionLedger = seasonUnavailable
		? []
		: promotionLedgerAll.filter((t: PromotionTransaction) => t.season === season);

	return {
		user: locals.user,
		rosterList,
		faabLedger,
		season,
		seasonUnavailable,
		promotionLedger,
		leagueConfig: {
			contentfulSpaceId: cfg.contentfulSpaceId,
			hasAccessToken: !!cfg.contentfulAccessToken,
			hasManagementToken: !!cfg.contentfulManagementToken,
			enabledNavItems: cfg.enabledNavItems,
			ruleset: cfg.ruleset ?? 'classic',
			premier: {
				tiersForSeason: cfg.premier?.tiersBySeason?.[season] ?? {},
				auctionBudget: cfg.premier?.auctionBudget ?? DEFAULT_AUCTION_BUDGET,
				faabBudget: cfg.premier?.faabBudget ?? DEFAULT_FAAB_BUDGET,
				tradeBudgetCap: cfg.premier?.tradeBudgetCap ?? DEFAULT_TRADE_BUDGET_CAP,
				regularSeasonEndWeek: cfg.premier?.regularSeasonEndWeek ?? DEFAULT_REGULAR_SEASON_END_WEEK,
			},
		},
	};
};

export const actions: Actions = {
	saveConfig: async ({ request, params, locals }) => {
		if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
		const data = await request.formData();

		const navRaw = (data.get('enabledNavItems') as string)?.trim();
		const enabledNavItems = navRaw
			? navRaw.split(',').filter(item => VALID_NAV_ITEMS.has(item))
			: undefined;

		const update: Parameters<typeof setLeagueConfig>[1] = { enabledNavItems };

		// Only update Contentful fields when explicitly provided — never delete on blank
		const contentfulSpaceId = (data.get('contentfulSpaceId') as string)?.trim();
		if (contentfulSpaceId) update.contentfulSpaceId = contentfulSpaceId;

		const accessToken = (data.get('contentfulAccessToken') as string)?.trim();
		if (accessToken) update.contentfulAccessToken = accessToken;

		const mgmtToken = (data.get('contentfulManagementToken') as string)?.trim();
		if (mgmtToken) update.contentfulManagementToken = mgmtToken;

		await setLeagueConfig(params.leagueId, update);
		return { configSuccess: true };
	},

	addFaab: async ({ request, params, locals }) => {
		if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
		const data = await request.formData();
		const rosterId = (data.get('rosterId') as string)?.trim();
		const amount = Number(data.get('amount'));
		const reason = (data.get('reason') as string)?.trim();

		if (!rosterId) return { faabError: 'Pick a manager.' };
		if (!Number.isFinite(amount) || amount === 0) return { faabError: 'Enter a non-zero amount (+ or −).' };
		if (!reason) return { faabError: 'A reason is required.' };

		// Validate the roster belongs to this league — a crafted POST shouldn't be
		// able to attach a ledger entry to a phantom team.
		const rosters = await fetchRosters(params.leagueId).catch(() => []);
		if (!rosters.some((r) => String(r.roster_id) === rosterId)) {
			return { faabError: 'Unknown roster for this league.' };
		}

		const createdBy = locals.user.sleeperUsername ?? locals.user.email ?? 'Commissioner';
		await addFaabTransaction(params.leagueId, { rosterId, amount, reason, createdBy });
		return { faabSuccess: true };
	},

	deleteFaab: async ({ request, params, locals }) => {
		if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
		const id = (await request.formData()).get('id') as string;
		if (!id) return { faabError: 'Missing transaction id.' };
		await deleteFaabTransaction(params.leagueId, id);
		return { faabSuccess: true };
	},

	deleteConfig: async ({ params, locals }) => {
		if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
		await deleteLeagueConfig(params.leagueId);
		throw redirect(303, `/league/${params.leagueId}`);
	},

	// ── Premier Keepers ──────────────────────────────────────────────────────────

	savePremierConfig: async ({ request, params, locals }) => {
		if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
		const data = await request.formData();

		const ruleset = data.get('ruleset') === 'premier' ? 'premier' : 'classic';

		const tierBudget = (prefix: string, fallback: TierBudget): TierBudget => {
			const one = Number(data.get(`${prefix}1`));
			const two = Number(data.get(`${prefix}2`));
			const three = Number(data.get(`${prefix}3`));
			return {
				1: Number.isFinite(one) && one > 0 ? one : fallback[1],
				2: Number.isFinite(two) && two > 0 ? two : fallback[2],
				3: Number.isFinite(three) && three > 0 ? three : fallback[3],
			};
		};

		const rawWeek = Number(data.get('regularSeasonEndWeek'));
		const cfg = await getLeagueConfig(params.leagueId);

		// ruleset lives on LeagueConfig, the premier block is written through
		// setPremierSettings — which mutates inside a Firestore transaction so a
		// stale cached read can't revert PP ledger entries or tier snapshots.
		await setLeagueConfig(params.leagueId, { ruleset });
		await setPremierSettings(params.leagueId, {
			auctionBudget: tierBudget('auctionBudget', cfg.premier?.auctionBudget ?? DEFAULT_AUCTION_BUDGET),
			faabBudget: tierBudget('faabBudget', cfg.premier?.faabBudget ?? DEFAULT_FAAB_BUDGET),
			tradeBudgetCap: tierBudget('tradeBudgetCap', cfg.premier?.tradeBudgetCap ?? DEFAULT_TRADE_BUDGET_CAP),
			regularSeasonEndWeek: clampRegularSeasonEndWeek(
				Number.isFinite(rawWeek) && rawWeek > 0 ? rawWeek : (cfg.premier?.regularSeasonEndWeek ?? DEFAULT_REGULAR_SEASON_END_WEEK),
			),
		});
		return { premierSuccess: true };
	},

	seedTiers: async ({ params, locals }) => {
		if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
		try {
			const { season, tiers } = await seedTiersFromSleeper(params.leagueId);
			return { tiersSuccess: true, seededSeason: season, seededCount: Object.keys(tiers).length };
		} catch (e: any) {
			return { tiersError: e.message ?? 'Failed to seed tiers from Sleeper.' };
		}
	},

	saveTiers: async ({ request, params, locals }) => {
		if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
		const data = await request.formData();
		const season = (data.get('season') as string)?.trim();
		if (!/^\d{4}$/.test(season ?? '')) return { tiersError: 'Enter a valid 4-digit season.' };

		// A degraded roster fetch would yield an empty form parse, and writing that
		// would erase the season's tier snapshot (and with it every PP number).
		// Fail the action instead of persisting the damage.
		let rosters;
		try {
			rosters = await fetchRosters(params.leagueId);
		} catch {
			return { tiersError: 'Could not reach Sleeper to confirm the roster list — tiers were not saved. Try again.' };
		}
		if (rosters.length === 0) {
			return { tiersError: 'Sleeper returned no rosters for this league — tiers were not saved.' };
		}

		const tiers: Record<string, 1 | 2 | 3> = {};
		const unassigned: number[] = [];
		for (const r of rosters) {
			const tier = Number(data.get(`tier_${r.roster_id}`));
			if (tier === 1 || tier === 2 || tier === 3) tiers[String(r.roster_id)] = tier;
			else unassigned.push(r.roster_id);
		}
		if (Object.keys(tiers).length === 0) {
			return { tiersError: 'No tiers were selected — nothing saved.' };
		}

		try {
			await setSeasonTiers(params.leagueId, season, tiers);
		} catch (e: any) {
			return { tiersError: e?.message ?? 'Failed to save tiers.' };
		}
		return {
			tiersSuccess: true,
			seededSeason: season,
			seededCount: Object.keys(tiers).length,
			// Surfaced rather than silently dropped: an unassigned roster scores no
			// PP at all, and a tier short of 4 teams disables its play-ins.
			unassignedRosters: unassigned,
		};
	},

	addPromotion: async ({ request, params, locals }) => {
		if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
		const data = await request.formData();
		const rosterId = (data.get('rosterId') as string)?.trim();
		const season = (data.get('season') as string)?.trim();
		const kind = data.get('kind') as PromotionTransaction['kind'];
		const reason = (data.get('reason') as string)?.trim();
		const rawAmount = data.get('amount');

		if (!rosterId) return { promotionError: 'Pick a manager.' };
		if (!/^\d{4}$/.test(season ?? '')) return { promotionError: 'Enter a valid 4-digit season.' };

		// PP standings only read the live season's entries, and neglect escalation
		// counts per season — so a mistyped year silently creates an entry that
		// never applies and resets the offense count back to a first offense.
		const league = await getCachedLeague(params.leagueId).catch(() => null);
		if (league?.season && season !== league.season) {
			return { promotionError: `This league's current season is ${league.season}. Entries for ${season} would never affect its standings.` };
		}
		if (!['collusion', 'neglect', 'other'].includes(kind)) return { promotionError: 'Pick a reason type.' };
		if (!reason) return { promotionError: 'A reason is required.' };

		let amount: number | undefined;
		if (kind === 'other') {
			amount = Number(rawAmount);
			if (!Number.isFinite(amount) || amount === 0) return { promotionError: 'Enter a non-zero amount (+ or −).' };
		}

		const rosters = await fetchRosters(params.leagueId).catch(() => []);
		if (!rosters.some((r) => String(r.roster_id) === rosterId)) {
			return { promotionError: 'Unknown roster for this league.' };
		}

		const createdBy = locals.user.sleeperUsername ?? locals.user.email ?? 'Commissioner';
		await addPromotionTransaction(params.leagueId, { rosterId, season, kind, amount, reason, createdBy });
		return { promotionSuccess: true };
	},

	deletePromotion: async ({ request, params, locals }) => {
		if (!locals.user?.isAdmin) throw error(403, 'Forbidden');
		const id = (await request.formData()).get('id') as string;
		if (!id) return { promotionError: 'Missing transaction id.' };
		await deletePromotionTransaction(params.leagueId, id);
		return { promotionSuccess: true };
	},
};
