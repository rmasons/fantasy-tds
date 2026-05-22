<script lang="ts">
	import type { PageData } from './$types';
	import type { SleeperRoster, SleeperLeagueUser, SleeperLeague, StandingRow } from '$lib/types';
	import { onMount } from 'svelte';

	let { data } = $props<{ data: PageData }>();

	let standings = $state<StandingRow[]>([]);
	let loading = $state(true);
	let error = $state('');
	let season = $state('');

	onMount(async () => {
		try {
			const [rostersRes, usersRes, leagueRes] = await Promise.all([
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/rosters`),
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/users`),
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}`)
			]);

			const [rosters, users, league]: [SleeperRoster[], SleeperLeagueUser[], SleeperLeague] =
				await Promise.all([rostersRes.json(), usersRes.json(), leagueRes.json()]);

			season = league.season;

			// Build userId → user map
			const userMap = new Map<string, SleeperLeagueUser>(
				users.map((u) => [u.user_id, u])
			);

			// Build standings rows
			const rows: StandingRow[] = rosters.map((roster) => {
				const user = userMap.get(roster.owner_id);
				const fpts = (roster.settings.fpts ?? 0) + (roster.settings.fpts_decimal ?? 0) / 100;
				const fptsAgainst =
					(roster.settings.fpts_against ?? 0) + (roster.settings.fpts_against_decimal ?? 0) / 100;

				const avatarHash = user?.metadata?.avatar ?? user?.avatar;
				const avatar = avatarHash
					? `https://sleepercdn.com/avatars/thumbs/${avatarHash}`
					: null;

				return {
					rank: 0,
					rosterId: roster.roster_id,
					teamName: user?.metadata?.team_name ?? user?.display_name ?? 'Unknown',
					ownerName: user?.display_name ?? '',
					avatar,
					wins: roster.settings.wins ?? 0,
					losses: roster.settings.losses ?? 0,
					ties: roster.settings.ties ?? 0,
					fpts,
					fptsAgainst,
					streak: roster.metadata?.streak ?? '–'
				};
			});

			// Sort: wins desc → fpts desc
			rows.sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);
			rows.forEach((r, i) => (r.rank = i + 1));

			standings = rows;
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	});

	function streakClass(streak: string) {
		if (streak.startsWith('W')) return 'text-green-400';
		if (streak.startsWith('L')) return 'text-red-400';
		return 'text-gray-400';
	}
</script>

<div>
	<h1 class="text-2xl font-bold mb-1">Standings</h1>
	<p class="text-gray-500 text-sm mb-6">{season} Season</p>

	{#if loading}
		<div class="space-y-2">
			{#each Array(10) as _}
				<div class="h-14 bg-gray-800 rounded-xl animate-pulse"></div>
			{/each}
		</div>

	{:else if error}
		<p class="text-red-400">Failed to load standings: {error}</p>

	{:else if standings.length === 0}
		<p class="text-gray-400">No standings available yet — season may not have started.</p>

	{:else}
		<!-- Desktop table -->
		<div class="hidden sm:block overflow-x-auto rounded-xl border border-gray-800">
			<table class="w-full text-sm">
				<thead>
					<tr class="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider">
						<th class="px-4 py-3 text-left w-8">#</th>
						<th class="px-4 py-3 text-left">Team</th>
						<th class="px-4 py-3 text-center">W</th>
						<th class="px-4 py-3 text-center">L</th>
						{#if standings.some(s => s.ties > 0)}
							<th class="px-4 py-3 text-center">T</th>
						{/if}
						<th class="px-4 py-3 text-right">PF</th>
						<th class="px-4 py-3 text-right">PA</th>
						<th class="px-4 py-3 text-center">Streak</th>
					</tr>
				</thead>
				<tbody>
					{#each standings as row, i}
						<tr class="border-t border-gray-800 {i % 2 === 0 ? 'bg-gray-950' : 'bg-gray-900/50'}
						           hover:bg-gray-800/60 transition-colors">
							<td class="px-4 py-3 text-gray-500 font-mono text-xs">{row.rank}</td>
							<td class="px-4 py-3">
								<div class="flex items-center gap-3">
									{#if row.avatar}
										<img src={row.avatar} alt="" class="w-9 h-9 rounded-full object-cover shrink-0" />
									{:else}
										<div class="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center shrink-0 text-base">
											🏈
										</div>
									{/if}
									<div>
										<p class="font-medium text-white leading-tight">{row.teamName}</p>
										{#if row.ownerName && row.ownerName !== row.teamName}
											<p class="text-xs text-gray-500">{row.ownerName}</p>
										{/if}
									</div>
								</div>
							</td>
							<td class="px-4 py-3 text-center font-semibold text-white">{row.wins}</td>
							<td class="px-4 py-3 text-center text-gray-300">{row.losses}</td>
							{#if standings.some(s => s.ties > 0)}
								<td class="px-4 py-3 text-center text-gray-400">{row.ties}</td>
							{/if}
							<td class="px-4 py-3 text-right font-mono text-gray-200">{row.fpts.toFixed(2)}</td>
							<td class="px-4 py-3 text-right font-mono text-gray-400">{row.fptsAgainst.toFixed(2)}</td>
							<td class="px-4 py-3 text-center font-semibold {streakClass(row.streak)}">{row.streak}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Mobile cards -->
		<div class="sm:hidden space-y-2">
			{#each standings as row}
				<div class="bg-gray-900 rounded-xl px-4 py-3 flex items-center gap-3">
					<span class="text-gray-500 text-xs w-5 text-center">{row.rank}</span>
					{#if row.avatar}
						<img src={row.avatar} alt="" class="w-10 h-10 rounded-full object-cover shrink-0" />
					{:else}
						<div class="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center shrink-0">🏈</div>
					{/if}
					<div class="flex-1 min-w-0">
						<p class="font-medium text-white text-sm truncate">{row.teamName}</p>
						<p class="text-xs text-gray-500">{row.ownerName}</p>
					</div>
					<div class="text-right shrink-0">
						<p class="font-semibold text-white text-sm">{row.wins}–{row.losses}{row.ties > 0 ? `–${row.ties}` : ''}</p>
						<p class="text-xs {streakClass(row.streak)}">{row.streak} · {row.fpts.toFixed(0)} pts</p>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
