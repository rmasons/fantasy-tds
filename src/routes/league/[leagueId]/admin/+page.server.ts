import { redirect, error } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getLeagueConfig, setLeagueConfig, deleteLeagueConfig } from '$lib/server/config';
import { getFaabLedger, addFaabTransaction, deleteFaabTransaction } from '$lib/server/faab';
import { fetchRosters, fetchUsers, buildRosterInfoMap } from '$lib/sleeper';
import { adminDb } from '$lib/firebase/admin';
import { TOTAL_EGGS } from '$lib/eggs';

// Count claimed FAAB eggs so an admin can see when the hunt is exhausted and
// it's safe to retire (see EASTER_EGG_REMOVAL.md). Best-effort — a read failure
// just shows 0 claimed rather than breaking the admin page.
async function getEggProgress(leagueId: string): Promise<{ claimed: number; total: number }> {
	try {
		const doc = await adminDb().collection('faabEggs').doc(leagueId).get();
		const claimed = doc.exists ? Object.keys(doc.data() ?? {}).length : 0;
		return { claimed, total: TOTAL_EGGS };
	} catch (e) {
		console.error('[admin] failed to read egg progress for', leagueId, e);
		return { claimed: 0, total: TOTAL_EGGS };
	}
}

const VALID_NAV_ITEMS = new Set([
	'standings', 'matchups', 'power-rankings', 'rosters', 'history',
	'transactions', 'trades', 'drafts', 'managers', 'rivalry', 'keepers', 'superlatives', 'faab', 'blog',
]);

export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.user?.isAdmin) throw redirect(303, `/league/${params.leagueId}`);

	const [cfg, rosters, users, eggProgress, faabLedger] = await Promise.all([
		getLeagueConfig(params.leagueId),
		fetchRosters(params.leagueId).catch(() => []),
		fetchUsers(params.leagueId).catch(() => []),
		getEggProgress(params.leagueId),
		getFaabLedger(params.leagueId).catch(() => []),
	]);

	const infoMap = buildRosterInfoMap(rosters, users);
	const rosterList = rosters
		.map((r: any) => ({
			rosterId: String(r.roster_id),
			teamName: infoMap.get(r.roster_id)?.teamName ?? `Roster ${r.roster_id}`,
		}))
		.sort((a: any, b: any) => a.teamName.localeCompare(b.teamName));

	return {
		user: locals.user,
		rosterList,
		eggProgress,
		faabLedger,
		leagueConfig: {
			contentfulSpaceId: cfg.contentfulSpaceId,
			hasAccessToken: !!cfg.contentfulAccessToken,
			hasManagementToken: !!cfg.contentfulManagementToken,
			enabledNavItems: cfg.enabledNavItems,
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
};
