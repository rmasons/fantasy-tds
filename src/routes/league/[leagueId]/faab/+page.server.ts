import type { PageServerLoad } from './$types';
import { getFaabLedger, netFromLedger } from '$lib/server/faab';
import { fetchRosters, fetchUsers, buildRosterInfoMap } from '$lib/sleeper';

export const load: PageServerLoad = async ({ params }) => {
	const [ledgerRaw, rosters, users] = await Promise.all([
		getFaabLedger(params.leagueId).catch(() => []),
		fetchRosters(params.leagueId).catch(() => []),
		fetchUsers(params.leagueId).catch(() => []),
	]);

	const infoMap = buildRosterInfoMap(rosters, users);
	const teamOf = (rosterId: string) => {
		const info = infoMap.get(Number(rosterId));
		return { teamName: info?.teamName ?? `Roster ${rosterId}`, avatar: info?.avatar ?? null };
	};

	// Hide synthesized opening-balance rows from the public ledger — they're a
	// migration artifact, not a real transaction. Their value still shows in the
	// per-team net totals below.
	const ledger = ledgerRaw
		.filter((t) => t.reason !== 'Opening balance')
		.map((t) => ({ ...t, ...teamOf(t.rosterId) }));

	const totals = Object.entries(netFromLedger(ledgerRaw))
		.map(([rosterId, net]) => ({ rosterId, net, ...teamOf(rosterId) }))
		.sort((a, b) => b.net - a.net);

	return { ledger, totals };
};
