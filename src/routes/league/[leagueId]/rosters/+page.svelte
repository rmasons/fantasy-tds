<script lang="ts">
	import { onMount } from 'svelte';
	import type { LayoutData } from '../$types';
	import type { SlimPlayer } from '$lib/types';
	import { fetchLeague, fetchLeagueCore, buildRosterInfoMap, fetchDisplayNameOverrides } from '$lib/sleeper';
	import FaabEasterEgg from '$lib/components/FaabEasterEgg.svelte';

	let { data } = $props<{ data: LayoutData }>();

	interface SeasonEntry { leagueId: string; season: string }

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
	let seasons = $state<SeasonEntry[]>([]);
	let viewLeagueId = $state(data.leagueId);

	let playersCache: Record<string, SlimPlayer> = {};
	let playersCacheReady = false;

	onMount(() => {
		function updateCols() {
			const next = window.innerWidth >= 1024 ? 3 : window.innerWidth >= 640 ? 2 : 1;
			if (next !== colCount) {
				colCount = next;
				expandedRow = null;
			}
		}
		updateCols();
		window.addEventListener('resize', updateCols);

		// Pre-fetch players once
		fetch('/api/players').then(r => r.ok ? r.json() : {}).then(p => {
			playersCache = p;
			playersCacheReady = true;
		});

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

	$effect(() => {
		const urlLeagueId = data.leagueId;
		viewLeagueId = urlLeagueId;
		seasons = [];
		teams = [];
		loading = true;
		error = '';
		expandedRow = null;

		loadRosters(urlLeagueId);
		walkSeasons(urlLeagueId);
	});

	async function walkSeasons(urlLeagueId: string) {
		let curId: string | null = urlLeagueId;
		while (curId && curId !== '0') {
			try {
				const league = await fetchLeague(curId);
				if (data.leagueId !== urlLeagueId) return;
				seasons = [...seasons, { leagueId: curId, season: league.season }];
				curId = league.previous_league_id ?? null;
			} catch {
				return;
			}
		}
	}

	async function loadRosters(lid: string) {
		teams = [];
		loading = true;
		error = '';
		expandedRow = null;

		try {
			// Fetch players alongside league data (or use cache if ready)
			const playersPromise = playersCacheReady
				? Promise.resolve(playersCache)
				: fetch('/api/players').then((r) => r.json()) as Promise<Record<string, SlimPlayer>>;

			const [{ league, rosters, users }, players] = await Promise.all([
				fetchLeagueCore(lid),
				playersPromise,
			]);

			if (viewLeagueId !== lid) return;

			if (!playersCacheReady) {
				playersCache = players;
				playersCacheReady = true;
			}

			const starterSlots: string[] = (league as any).roster_positions ?? [];
			const overrides = await fetchDisplayNameOverrides(users.map(u => u.user_id));
			if (viewLeagueId !== lid) return;
			const rosterInfo = buildRosterInfoMap(rosters, users, overrides);

			teams = rosters.map((r) => {
				const info = rosterInfo.get(r.roster_id)!;
				const starterIds = new Set((r as any).starters ?? []);
				const irIds = new Set(r.reserve ?? []);
				const allIds: string[] = r.players ?? [];

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
			if (viewLeagueId !== lid) return;
			error = e.message;
		} finally {
			if (viewLeagueId !== lid) return;
			loading = false;
		}
	}

	function selectSeason(lid: string) {
		if (viewLeagueId === lid) return;
		viewLeagueId = lid;
		loadRosters(lid);
	}

	const posColor: Record<string, string> = {
		QB: 'bg-red-900/60 text-red-300',
		RB: 'bg-green-900/60 text-green-300',
		WR: 'bg-slate-800 text-slate-300',
		TE: 'bg-yellow-900/60 text-yellow-300',
		K: 'bg-purple-900/60 text-purple-300',
		DEF: 'bg-orange-900/60 text-orange-300'
	};
	function pc(pos: string) { return posColor[pos] ?? 'bg-slate-700 text-slate-300'; }
</script>

<div>
	<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none mb-6">Rosters</h1>

	{#if seasons.length > 1}
		<div class="flex mb-6 border-b border-navy-700 flex-wrap">
			{#each seasons as s}
				<button
					onclick={() => selectSeason(s.leagueId)}
					class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
					       {viewLeagueId === s.leagueId ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
				>
					{s.season}
				</button>
			{/each}
		</div>
	{/if}

	{#if loading}
		<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each Array(12) as _}
				<div class="h-24 bg-navy-850 rounded-lg animate-pulse"></div>
			{/each}
		</div>
	{:else if error}
		<p class="text-red-400">Failed to load rosters: {error}</p>
	{:else}
		<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each teams as team, i (team.rosterId)}
				<div class="bg-navy-850 rounded-lg border border-navy-700 overflow-hidden">
					<!-- Team header -->
					<button
						onclick={() => toggle(i)}
						class="w-full flex items-center gap-3 px-4 py-3 hover:bg-navy-800 transition-colors text-left"
					>
						{#if team.avatar}
							<img src={team.avatar} alt="" class="w-10 h-10 rounded-full object-cover shrink-0" />
						{:else}
							<div class="w-10 h-10 rounded-full bg-navy-800 flex items-center justify-center shrink-0">🏈</div>
						{/if}
						<div class="flex-1 min-w-0">
							<p class="font-medium text-white text-sm truncate">{team.teamName}</p>
							{#if team.ownerName && team.ownerName !== team.teamName}
								<p class="text-xs text-navy-500">{team.ownerName}</p>
							{/if}
						</div>
						<div class="text-navy-500 text-sm">{team.starters.length + team.bench.length}</div>
						<span class="text-navy-500 text-xs ml-1">{isExpanded(i) ? '▲' : '▼'}</span>
					</button>

					{#if isExpanded(i)}
						<div class="border-t border-navy-700 px-4 py-3 space-y-4">
							<!-- Starters -->
							{#if team.starters.length}
								<div>
									<p class="font-sport font-bold text-[10px] uppercase tracking-widest text-slate-300 mb-2 flex items-center gap-1.5"><span class="text-amber-400">◆</span>Starters</p>
									<div class="space-y-1">
										{#each team.starters as p}
											{@const logo = teamLogoUrl(p.team)}
											<div class="flex items-center gap-2 text-sm">
												<span class="text-xs w-16 text-center py-0.5 rounded font-bold shrink-0 {pc(p.pos)}">{p.pos}</span>
												<span class="text-slate-200 truncate flex-1">{p.name}</span>
												<span class="flex items-center gap-1 shrink-0">
													{#if logo}
														<img src={logo} alt={p.team} class="w-4 h-4 object-contain" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
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
									<p class="font-sport font-bold text-[10px] uppercase tracking-widest text-slate-300 mb-2 flex items-center gap-1.5"><span class="text-amber-400">◆</span>Bench{#if i === teams.length - 1}<FaabEasterEgg eggId="7" leagueId={data.leagueId} loggedIn={!!data.user} />{/if}</p>
									<div class="space-y-1">
										{#each team.bench as p}
											{@const logo = teamLogoUrl(p.team)}
											<div class="flex items-center gap-2 text-sm">
												<span class="text-xs w-16 text-center py-0.5 rounded font-bold shrink-0 {pc(p.pos)}">{p.pos}</span>
												<span class="text-slate-400 truncate flex-1">{p.name}</span>
												<span class="flex items-center gap-1 shrink-0">
													{#if logo}
														<img src={logo} alt={p.team} class="w-4 h-4 object-contain" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
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
									<p class="font-sport font-bold text-[10px] uppercase tracking-widest text-red-400/80 mb-2 flex items-center gap-1.5"><span class="text-red-500">◆</span>IR</p>
									<div class="space-y-1">
										{#each team.ir as p}
											{@const logo = teamLogoUrl(p.team)}
											<div class="flex items-center gap-2 text-sm">
												<span class="text-xs w-16 text-center py-0.5 rounded font-bold shrink-0 bg-red-900/50 text-red-400">{p.pos}</span>
												<span class="text-slate-400 truncate flex-1">{p.name}</span>
												<span class="flex items-center gap-1 shrink-0">
													{#if logo}
														<img src={logo} alt={p.team} class="w-4 h-4 object-contain" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
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
