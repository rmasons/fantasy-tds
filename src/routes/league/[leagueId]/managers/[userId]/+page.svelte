<script lang="ts">
	import type { PageData } from './$types';
	import { onMount } from 'svelte';

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

	function fpts(r: any) {
		return (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;
	}

	onMount(async () => {
		try {
			const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${data.leagueId}`);
			const current = await leagueRes.json();

			let curId: string = data.leagueId;
			const result: SeasonStat[] = [];

			while (curId && curId !== '0') {
				const [leagueData, users, rosters] = await Promise.all([
					curId === data.leagueId ? Promise.resolve(current) : fetch(`https://api.sleeper.app/v1/league/${curId}`).then(r => r.json()),
					fetch(`https://api.sleeper.app/v1/league/${curId}/users`).then(r => r.json()),
					fetch(`https://api.sleeper.app/v1/league/${curId}/rosters`).then(r => r.json()),
				]);

				loadingStatus = `Loaded ${leagueData.season}…`;

				const userMeta = (users as any[]).find((u: any) => u.user_id === data.userId);
				const roster = (rosters as any[]).find((r: any) => r.owner_id === data.userId);

				if (roster) {
					if (!manager && userMeta) {
						manager = {
							userId: data.userId,
							displayName: userMeta.display_name ?? data.userId,
							teamName: userMeta.metadata?.team_name ?? userMeta.display_name ?? data.userId,
							avatar: userMeta.avatar ? `https://sleepercdn.com/avatars/thumbs/${userMeta.avatar}` : null,
						};
					}

					result.push({
						season: leagueData.season,
						teamName: userMeta?.metadata?.team_name ?? userMeta?.display_name ?? `Roster ${roster.roster_id}`,
						wins: roster.settings?.wins ?? 0,
						losses: roster.settings?.losses ?? 0,
						ties: roster.settings?.ties ?? 0,
						fpts: fpts(roster),
						fptsAgainst: (roster.settings?.fpts_against ?? 0) + (roster.settings?.fpts_against_decimal ?? 0) / 100,
						rosterId: roster.roster_id,
					});
				}

				curId = leagueData.previous_league_id;
			}

			seasons = result;
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
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
	<a href="/league/{data.leagueId}/managers" class="text-gray-500 hover:text-gray-300 text-sm mb-6 inline-flex items-center gap-1 transition-colors">
		← All Managers
	</a>

	{#if loading && !manager}
		<div class="space-y-3 mt-4">
			<div class="h-24 bg-gray-800 rounded-xl animate-pulse"></div>
			<div class="h-48 bg-gray-800 rounded-xl animate-pulse"></div>
			<p class="text-gray-500 text-sm">{loadingStatus}</p>
		</div>
	{:else if error}
		<p class="text-red-400 mt-4">Failed to load manager: {error}</p>
	{:else if manager}
		<!-- Manager header -->
		<div class="flex items-center gap-4 mt-4 mb-8 p-5 bg-gray-900 rounded-xl border border-gray-800">
			{#if manager.avatar}
				<img src={manager.avatar} alt="" class="w-20 h-20 rounded-full object-cover border-2 border-gray-700 shrink-0" />
			{:else}
				<div class="w-20 h-20 rounded-full bg-gray-700 flex items-center justify-center text-4xl shrink-0">🏈</div>
			{/if}
			<div>
				<h1 class="text-2xl font-bold text-white">{manager.teamName}</h1>
				<p class="text-gray-400 text-sm">{manager.displayName}</p>
				{#if careerGames > 0}
					<div class="flex gap-4 mt-2 text-sm">
						<span class="text-gray-300">{careerWins}–{careerLosses}{careerTies ? `–${careerTies}` : ''} career</span>
						<span class="text-gray-500">{winPct}% win rate</span>
						<span class="text-gray-500">{careerFpts.toFixed(2)} total pts</span>
					</div>
				{/if}
			</div>
		</div>

		<!-- Season history -->
		{#if seasons.length > 0}
			<h2 class="text-lg font-semibold mb-3 text-gray-300">Season History</h2>
			<div class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-gray-800 text-gray-500 text-xs uppercase">
							<th class="px-4 py-3 text-left">Season</th>
							<th class="px-4 py-3 text-left">Team Name</th>
							<th class="px-4 py-3 text-right">W–L{careerTies ? '–T' : ''}</th>
							<th class="px-4 py-3 text-right">PF</th>
							<th class="px-4 py-3 text-right hidden sm:table-cell">PA</th>
						</tr>
					</thead>
					<tbody>
						{#each seasons as s}
							<tr class="border-b border-gray-800/50 hover:bg-gray-800/30">
								<td class="px-4 py-3 font-mono text-gray-400">{s.season}</td>
								<td class="px-4 py-3 text-gray-200 truncate max-w-[140px]">{s.teamName}</td>
								<td class="px-4 py-3 text-right text-gray-300">
									{s.wins}–{s.losses}{s.ties ? `–${s.ties}` : ''}
								</td>
								<td class="px-4 py-3 text-right text-gray-400">{s.fpts.toFixed(2)}</td>
								<td class="px-4 py-3 text-right text-gray-600 hidden sm:table-cell">{s.fptsAgainst.toFixed(2)}</td>
							</tr>
						{/each}
					</tbody>
					{#if seasons.length > 1}
						<tfoot>
							<tr class="border-t border-gray-700 bg-gray-800/30">
								<td class="px-4 py-3 text-gray-500 text-xs uppercase font-medium" colspan="2">Career</td>
								<td class="px-4 py-3 text-right font-semibold text-gray-300">
									{careerWins}–{careerLosses}{careerTies ? `–${careerTies}` : ''}
								</td>
								<td class="px-4 py-3 text-right font-semibold text-gray-400">{careerFpts.toFixed(2)}</td>
								<td class="px-4 py-3 hidden sm:table-cell"></td>
							</tr>
						</tfoot>
					{/if}
				</table>
			</div>
			{#if loading}
				<p class="text-gray-600 text-xs mt-2">{loadingStatus}</p>
			{/if}
		{:else if !loading}
			<p class="text-gray-400">No season data found for this manager.</p>
		{/if}
	{/if}
</div>
