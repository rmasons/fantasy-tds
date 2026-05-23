<script lang="ts">
	import { onMount } from 'svelte';
	import type { LayoutData } from '../$types';
	import type { SlimPlayer } from '$lib/types';
	import { fetchLeagueCore, buildRosterInfoMap } from '$lib/sleeper';

	let { data } = $props<{ data: LayoutData }>();

	interface RosterTeam {
		rosterId: number;
		teamName: string;
		ownerName: string | null;
		avatar: string | null;
		starters: { id: string; name: string; pos: string; team: string }[];
		bench: { id: string; name: string; pos: string; team: string }[];
		ir: { id: string; name: string; pos: string; team: string }[];
		starterSlots: string[];
	}

	let teams = $state<RosterTeam[]>([]);
	let loading = $state(true);
	let error = $state('');
	let expandedRow = $state<number | null>(null);
	let colCount = $state(1);

	onMount(() => {
		function updateCols() {
			if (window.innerWidth >= 1024) colCount = 3;
			else if (window.innerWidth >= 640) colCount = 2;
			else colCount = 1;
			expandedRow = null;
		}
		updateCols();
		window.addEventListener('resize', updateCols);
		return () => window.removeEventListener('resize', updateCols);
	});

	function toggle(i: number) {
		const row = Math.floor(i / colCount);
		expandedRow = expandedRow === row ? null : row;
	}

	function isExpanded(i: number): boolean {
		return Math.floor(i / colCount) === expandedRow;
	}

	function teamLogoUrl(team: string): string | null {
		if (!team || team === 'FA' || team === '?') return null;
		return `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`;
	}

	function playerInfo(id: string, players: Record<string, SlimPlayer>) {
		const p = players[id];
		return p ? { id, name: p.name, pos: p.pos, team: p.team } : { id, name: id, pos: '?', team: 'FA' };
	}

	const posOrder = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', 'IDP_FLEX', 'BN', 'IR'];

	$effect(() => {
		const leagueId = data.leagueId;
		teams = [];
		loading = true;
		error = '';
		expandedRow = null;

		(async () => {
			try {
				const [{ league, rosters, users }, players] = await Promise.all([
					fetchLeagueCore(leagueId),
					fetch('/api/players').then((r) => r.json()) as Promise<Record<string, SlimPlayer>>,
				]);

				if (data.leagueId !== leagueId) return;

				const starterSlots: string[] = (league as any).roster_positions ?? [];
				const rosterInfo = buildRosterInfoMap(rosters, users);

				teams = rosters.map((r) => {
					const info = rosterInfo.get(r.roster_id)!;
					const starterIds = new Set((r as any).starters ?? []);
					const irIds = new Set((r as any).reserve ?? []);
					const allIds: string[] = (r as any).players ?? [];

					return {
						rosterId: r.roster_id,
						teamName: info.teamName,
						ownerName: info.ownerName,
						avatar: info.avatar,
						starterSlots,
						starters: [...starterIds].map((id) => playerInfo(id as string, players)),
						bench: allIds
							.filter((id) => !starterIds.has(id) && !irIds.has(id))
							.map((id) => playerInfo(id, players)),
						ir: [...irIds].map((id) => playerInfo(id as string, players))
					};
				});

				teams.sort((a, b) => a.teamName.localeCompare(b.teamName));
			} catch (e: any) {
				if (data.leagueId !== leagueId) return;
				error = e.message;
			} finally {
				if (data.leagueId !== leagueId) return;
				loading = false;
			}
		})();
	});

	const posColor: Record<string, string> = {
		QB: 'bg-red-900/60 text-red-300',
		RB: 'bg-green-900/60 text-green-300',
		WR: 'bg-blue-900/60 text-blue-300',
		TE: 'bg-yellow-900/60 text-yellow-300',
		K: 'bg-purple-900/60 text-purple-300',
		DEF: 'bg-orange-900/60 text-orange-300'
	};
	function pc(pos: string) { return posColor[pos] ?? 'bg-slate-700 text-slate-300'; }
</script>

<div>
	<h1 class="text-2xl font-bold mb-6">Rosters</h1>

	{#if loading}
		<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each Array(12) as _}
				<div class="h-24 bg-slate-800 rounded-xl animate-pulse"></div>
			{/each}
		</div>
	{:else if error}
		<p class="text-red-400">Failed to load rosters: {error}</p>
	{:else}
		<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each teams as team, i (team.rosterId)}
				<div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
					<!-- Team header -->
					<button
						onclick={() => toggle(i)}
						class="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/60 transition-colors text-left"
					>
						{#if team.avatar}
							<img src={team.avatar} alt="" class="w-10 h-10 rounded-full object-cover shrink-0" />
						{:else}
							<div class="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center shrink-0">🏈</div>
						{/if}
						<div class="flex-1 min-w-0">
							<p class="font-medium text-white text-sm truncate">{team.teamName}</p>
							{#if team.ownerName && team.ownerName !== team.teamName}
								<p class="text-xs text-slate-500">{team.ownerName}</p>
							{/if}
						</div>
						<div class="text-slate-500 text-sm">{team.starters.length + team.bench.length}</div>
						<span class="text-slate-500 text-xs ml-1">{isExpanded(i) ? '▲' : '▼'}</span>
					</button>

					{#if isExpanded(i)}
						<div class="border-t border-slate-800 px-4 py-3 space-y-4">
							<!-- Starters -->
							{#if team.starters.length}
								<div>
									<p class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Starters</p>
									<div class="space-y-1">
										{#each team.starters as p}
											<div class="flex items-center gap-2 text-sm">
												<span class="text-xs w-16 text-center py-0.5 rounded font-bold shrink-0 {pc(p.pos)}">{p.pos}</span>
												<span class="text-slate-200 truncate flex-1">{p.name}</span>
												<span class="flex items-center gap-1 shrink-0">
													{#if teamLogoUrl(p.team)}
														<img src={teamLogoUrl(p.team)} alt={p.team} class="w-4 h-4 object-contain" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
													{/if}
													<span class="text-xs text-slate-500">{p.team}</span>
												</span>
											</div>
										{/each}
									</div>
								</div>
							{/if}

							<!-- Bench -->
							{#if team.bench.length}
								<div>
									<p class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Bench</p>
									<div class="space-y-1">
										{#each team.bench as p}
											<div class="flex items-center gap-2 text-sm">
												<span class="text-xs w-16 text-center py-0.5 rounded font-bold shrink-0 {pc(p.pos)}">{p.pos}</span>
												<span class="text-slate-400 truncate flex-1">{p.name}</span>
												<span class="flex items-center gap-1 shrink-0">
													{#if teamLogoUrl(p.team)}
														<img src={teamLogoUrl(p.team)} alt={p.team} class="w-4 h-4 object-contain" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
													{/if}
													<span class="text-xs text-slate-600">{p.team}</span>
												</span>
											</div>
										{/each}
									</div>
								</div>
							{/if}

							<!-- IR -->
							{#if team.ir.length}
								<div>
									<p class="text-xs font-semibold text-red-500/70 uppercase tracking-wider mb-2">IR</p>
									<div class="space-y-1">
										{#each team.ir as p}
											<div class="flex items-center gap-2 text-sm">
												<span class="text-xs w-16 text-center py-0.5 rounded font-bold shrink-0 bg-red-900/50 text-red-400">{p.pos}</span>
												<span class="text-slate-400 truncate flex-1">{p.name}</span>
												<span class="flex items-center gap-1 shrink-0">
													{#if teamLogoUrl(p.team)}
														<img src={teamLogoUrl(p.team)} alt={p.team} class="w-4 h-4 object-contain" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
													{/if}
													<span class="text-xs text-slate-600">{p.team}</span>
												</span>
											</div>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
