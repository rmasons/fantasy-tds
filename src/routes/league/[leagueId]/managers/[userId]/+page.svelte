<script lang="ts">
	import type { PageData } from './$types';
	import { fetchLeague, fetchRosters, fetchUsers, avatarUrl, combineFpts } from '$lib/sleeper';

	let { data } = $props<{ data: PageData }>();

	interface SeasonStat {
		season: string;
		teamName: string;
		wins: number;
		losses: number;
		ties: number;
		fpts: number;
		fptsAgainst: number;
		rosterId: number;
	}

	interface ManagerInfo {
		userId: string;
		displayName: string;
		teamName: string;
		avatar: string | null;
	}

	let manager = $state<ManagerInfo | null>(null);
	let seasons = $state<SeasonStat[]>([]);
	let loading = $state(true);
	let loadingStatus = $state('Loading…');
	let error = $state('');

	$effect(() => {
		const leagueId = data.leagueId;
		const userId = data.userId;
		manager = null;
		seasons = [];
		loading = true;
		loadingStatus = 'Loading…';
		error = '';

		(async () => {
			try {
				let curId: string | null = leagueId;
				const result: SeasonStat[] = [];

				while (curId && curId !== '0') {
					const [leagueData, users, rosters] = await Promise.all([
						fetchLeague(curId),
						fetchUsers(curId),
						fetchRosters(curId),
					]);

					if (data.leagueId !== leagueId || data.userId !== userId) return;

					loadingStatus = `Loaded ${leagueData.season}…`;

					const userMeta = (users as any[]).find((u: any) => u.user_id === userId);
					const roster = (rosters as any[]).find((r: any) => r.owner_id === userId);

					if (roster) {
						if (!manager && userMeta) {
							manager = {
								userId,
								displayName: userMeta.display_name ?? userId,
								teamName: userMeta.metadata?.team_name ?? userMeta.display_name ?? userId,
								avatar: avatarUrl(userMeta.avatar),
							};
						}

						result.push({
							season: leagueData.season,
							teamName: userMeta?.metadata?.team_name ?? userMeta?.display_name ?? `Roster ${roster.roster_id}`,
							wins: roster.settings?.wins ?? 0,
							losses: roster.settings?.losses ?? 0,
							ties: roster.settings?.ties ?? 0,
							fpts: combineFpts(roster.settings?.fpts, roster.settings?.fpts_decimal),
							fptsAgainst: combineFpts(roster.settings?.fpts_against, roster.settings?.fpts_against_decimal),
							rosterId: roster.roster_id,
						});
					}

					curId = leagueData.previous_league_id ?? null;
				}

				if (data.leagueId !== leagueId || data.userId !== userId) return;
				seasons = result;
			} catch (e: any) {
				if (data.leagueId !== leagueId || data.userId !== userId) return;
				error = e.message;
			} finally {
				if (data.leagueId !== leagueId || data.userId !== userId) return;
				loading = false;
			}
		})();
	});

	const careerWins = $derived(seasons.reduce((s, x) => s + x.wins, 0));
	const careerLosses = $derived(seasons.reduce((s, x) => s + x.losses, 0));
	const careerTies = $derived(seasons.reduce((s, x) => s + x.ties, 0));
	const careerFpts = $derived(seasons.reduce((s, x) => s + x.fpts, 0));
	const careerGames = $derived(careerWins + careerLosses + careerTies);
	const winPct = $derived(careerGames > 0 ? ((careerWins + careerTies * 0.5) / careerGames * 100).toFixed(1) : '—');
</script>

<div>
	<!-- Back link -->
	<a href="/league/{data.leagueId}/managers" class="text-slate-500 hover:text-slate-300 text-sm mb-6 inline-flex items-center gap-1 transition-colors">
		← All Managers
	</a>

	{#if loading && !manager}
		<div class="space-y-3 mt-4">
			<div class="h-24 bg-slate-800 rounded-xl animate-pulse"></div>
			<div class="h-48 bg-slate-800 rounded-xl animate-pulse"></div>
			<p class="text-slate-500 text-sm">{loadingStatus}</p>
		</div>
	{:else if error}
		<p class="text-red-400 mt-4">Failed to load manager: {error}</p>
	{:else if manager}
		<!-- Manager header -->
		<div class="flex items-center gap-4 mt-4 mb-8 p-5 bg-slate-900 rounded-xl border border-slate-800">
			{#if manager.avatar}
				<img src={manager.avatar} alt="" class="w-20 h-20 rounded-full object-cover border-2 border-slate-700 shrink-0" />
			{:else}
				<div class="w-20 h-20 rounded-full bg-slate-700 flex items-center justify-center text-4xl shrink-0">🏈</div>
			{/if}
			<div>
				<h1 class="text-2xl font-bold text-white">{manager.teamName}</h1>
				<p class="text-slate-400 text-sm">{manager.displayName}</p>
				{#if careerGames > 0}
					<div class="flex gap-4 mt-2 text-sm">
						<span class="text-slate-300">{careerWins}–{careerLosses}{careerTies ? `–${careerTies}` : ''} career</span>
						<span class="text-slate-500">{winPct}% win rate</span>
						<span class="text-slate-500">{careerFpts.toFixed(2)} total pts</span>
					</div>
				{/if}
			</div>
		</div>

		<!-- Season history -->
		{#if seasons.length > 0}
			<h2 class="text-lg font-semibold mb-3 text-slate-300">Season History</h2>
			<div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-slate-800 text-slate-500 text-xs uppercase">
							<th class="px-4 py-3 text-left">Season</th>
							<th class="px-4 py-3 text-left">Team Name</th>
							<th class="px-4 py-3 text-right">W–L{careerTies ? '–T' : ''}</th>
							<th class="px-4 py-3 text-right">PF</th>
							<th class="px-4 py-3 text-right hidden sm:table-cell">PA</th>
						</tr>
					</thead>
					<tbody>
						{#each seasons as s}
							<tr class="border-b border-slate-800/50 hover:bg-slate-800/30">
								<td class="px-4 py-3 font-mono text-slate-400">{s.season}</td>
								<td class="px-4 py-3 text-slate-200 truncate max-w-[140px]">{s.teamName}</td>
								<td class="px-4 py-3 text-right text-slate-300">
									{s.wins}–{s.losses}{s.ties ? `–${s.ties}` : ''}
								</td>
								<td class="px-4 py-3 text-right text-slate-400">{s.fpts.toFixed(2)}</td>
								<td class="px-4 py-3 text-right text-slate-600 hidden sm:table-cell">{s.fptsAgainst.toFixed(2)}</td>
							</tr>
						{/each}
					</tbody>
					{#if seasons.length > 1}
						<tfoot>
							<tr class="border-t border-slate-700 bg-slate-800/30">
								<td class="px-4 py-3 text-slate-500 text-xs uppercase font-medium" colspan="2">Career</td>
								<td class="px-4 py-3 text-right font-semibold text-slate-300">
									{careerWins}–{careerLosses}{careerTies ? `–${careerTies}` : ''}
								</td>
								<td class="px-4 py-3 text-right font-semibold text-slate-400">{careerFpts.toFixed(2)}</td>
								<td class="px-4 py-3 hidden sm:table-cell"></td>
							</tr>
						</tfoot>
					{/if}
				</table>
			</div>
			{#if loading}
				<p class="text-slate-600 text-xs mt-2">{loadingStatus}</p>
			{/if}
		{:else if !loading}
			<p class="text-slate-400">No season data found for this manager.</p>
		{/if}
	{/if}
</div>
