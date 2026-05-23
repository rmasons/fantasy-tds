<script lang="ts">
	import type { PageData } from './$types';
	import type { StandingRow } from '$lib/types';
	import { fetchLeagueCore, buildRosterInfoMap, combineFpts } from '$lib/sleeper';

	let { data } = $props<{ data: PageData }>();

	let standings = $state<StandingRow[]>([]);
	let loading = $state(true);
	let error = $state('');
	let season = $state('');

	$effect(() => {
		const leagueId = data.leagueId;
		standings = [];
		loading = true;
		error = '';
		season = '';

		(async () => {
			try {
				const { league, rosters, users } = await fetchLeagueCore(leagueId);

				if (data.leagueId !== leagueId) return;

				season = league.season;

				const rosterInfo = buildRosterInfoMap(rosters, users);

				const rows: StandingRow[] = rosters.map((roster) => {
					const info = rosterInfo.get(roster.roster_id)!;
					return {
						rank: 0,
						rosterId: roster.roster_id,
						teamName: info.teamName,
						ownerName: info.ownerName,
						avatar: info.avatar,
						wins: roster.settings.wins ?? 0,
						losses: roster.settings.losses ?? 0,
						ties: roster.settings.ties ?? 0,
						fpts: combineFpts(roster.settings.fpts, roster.settings.fpts_decimal),
						fptsAgainst: combineFpts(roster.settings.fpts_against, roster.settings.fpts_against_decimal),
						streak: roster.metadata?.streak ?? '–'
					};
				});

				rows.sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);
				rows.forEach((r, i) => (r.rank = i + 1));

				standings = rows;
			} catch (e: any) {
				if (data.leagueId !== leagueId) return;
				error = e.message;
			} finally {
				if (data.leagueId !== leagueId) return;
				loading = false;
			}
		})();
	});

	function rankStyle(rank: number) {
		if (rank === 1) return 'text-amber-400 font-bold';
		if (rank === 2) return 'text-slate-300 font-semibold';
		if (rank === 3) return 'text-orange-600 font-semibold';
		return 'text-slate-600';
	}

	function rowStyle(rank: number) {
		if (rank === 1) return 'bg-amber-500/[0.07] border-l-2 border-amber-400/60';
		return '';
	}

	function streakClass(streak: string) {
		if (streak.startsWith('W')) return 'text-green-400 bg-green-500/10';
		if (streak.startsWith('L')) return 'text-red-400 bg-red-500/10';
		return 'text-slate-400 bg-slate-800';
	}

	const hasTies = $derived(standings.some(s => s.ties > 0));
</script>

<div>
	<div class="mb-6">
		<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">Standings</h1>
		<p class="text-navy-500 text-[10px] uppercase tracking-[0.2em] font-semibold mt-1">{season} Season</p>
	</div>

	{#if loading}
		<div class="space-y-2">
			{#each Array(10) as _}
				<div class="h-14 bg-navy-850 rounded-lg animate-pulse"></div>
			{/each}
		</div>

	{:else if error}
		<div class="bg-navy-850 rounded-lg border border-navy-700 p-6 text-center">
			<p class="text-slate-400">Failed to load standings.</p>
			<p class="text-navy-500 text-sm mt-1">{error}</p>
		</div>

	{:else if standings.length === 0}
		<p class="text-navy-500">No standings available yet — season may not have started.</p>

	{:else}
		<!-- Desktop table -->
		<div class="hidden sm:block overflow-x-auto rounded-lg border border-navy-700">
			<table class="w-full text-sm">
				<thead>
					<tr class="bg-navy-900 text-navy-500 text-[10px] uppercase tracking-wider border-b border-navy-700">
						<th class="px-4 py-3 text-left w-8">#</th>
						<th class="px-4 py-3 text-left">Team</th>
						<th class="px-4 py-3 text-center">W</th>
						<th class="px-4 py-3 text-center">L</th>
						{#if hasTies}
							<th class="px-4 py-3 text-center">T</th>
						{/if}
						<th class="px-4 py-3 text-right">PF</th>
						<th class="px-4 py-3 text-right">PA</th>
						<th class="px-4 py-3 text-center">Streak</th>
					</tr>
				</thead>
				<tbody>
					{#each standings as row, i}
						<tr class="border-t border-navy-700/50 hover:bg-navy-800 transition-colors {rowStyle(row.rank)}
						           {i % 2 !== 0 ? 'bg-navy-875' : ''}">
							<td class="px-4 py-3">
								<span class="font-mono text-xs {rankStyle(row.rank)}">{row.rank}</span>
							</td>
							<td class="px-4 py-3">
								<div class="flex items-center gap-3">
									{#if row.avatar}
										<img src={row.avatar} alt="" class="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
									{:else}
										<div class="w-9 h-9 rounded-full bg-navy-800 flex items-center justify-center shrink-0 text-base">🏈</div>
									{/if}
									<div>
										<p class="font-semibold text-white leading-tight">{row.teamName}</p>
										{#if row.ownerName && row.ownerName !== row.teamName}
											<p class="text-xs text-navy-500">{row.ownerName}</p>
										{/if}
									</div>
								</div>
							</td>
							<td class="px-4 py-3 text-center font-mono font-bold text-white tabular-nums">{row.wins}</td>
							<td class="px-4 py-3 text-center font-mono text-slate-500 tabular-nums">{row.losses}</td>
							{#if hasTies}
								<td class="px-4 py-3 text-center font-mono text-navy-500 tabular-nums">{row.ties}</td>
							{/if}
							<td class="px-4 py-3 text-right font-mono tabular-nums {row.rank === 1 ? 'text-amber-400 font-semibold' : 'text-slate-200'}">{row.fpts.toFixed(2)}</td>
							<td class="px-4 py-3 text-right font-mono text-navy-500 tabular-nums">{row.fptsAgainst.toFixed(2)}</td>
							<td class="px-4 py-3 text-center">
								<span class="inline-block px-2 py-0.5 rounded text-xs font-bold {streakClass(row.streak)}">
									{row.streak}
								</span>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Mobile cards -->
		<div class="sm:hidden space-y-2">
			{#each standings as row}
				<div class="bg-navy-850 rounded-lg border border-navy-700 px-4 py-3 flex items-center gap-3 {rowStyle(row.rank)}">
					<span class="font-mono text-xs w-5 text-center shrink-0 {rankStyle(row.rank)}">{row.rank}</span>
					{#if row.avatar}
						<img src={row.avatar} alt="" class="w-10 h-10 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
					{:else}
						<div class="w-10 h-10 rounded-full bg-navy-800 flex items-center justify-center shrink-0">🏈</div>
					{/if}
					<div class="flex-1 min-w-0">
						<p class="font-semibold text-white text-sm truncate">{row.teamName}</p>
						<p class="text-xs text-navy-500">{row.ownerName}</p>
					</div>
					<div class="text-right shrink-0">
						<p class="font-bold text-white text-sm tabular-nums">{row.wins}–{row.losses}{row.ties > 0 ? `–${row.ties}` : ''}</p>
						<p class="text-xs text-navy-500 tabular-nums">
							<span class={streakClass(row.streak).split(' ')[0]}>{row.streak}</span>
							<span class="text-navy-700"> · </span>{row.fpts.toFixed(0)} pts
						</p>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
