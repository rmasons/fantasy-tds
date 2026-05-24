<script lang="ts">
	import type { PageData } from './$types';
	import type { SleeperLeague, SleeperNflState } from '$lib/types';
	import { fetchLeague, fetchNflState, fetchUsers, fetchRosters, fetchWinnersBracket, buildRosterInfoMap, fetchDisplayNameOverrides } from '$lib/sleeper';

	let { data } = $props<{ data: PageData }>();

	let league = $state<SleeperLeague | null>(null);
	let nflState = $state<SleeperNflState | null>(null);
	let loading = $state(true);

	interface Champion {
		teamName: string;
		ownerName: string | null;
		avatar: string | null;
		season: string;
	}
	let champion = $state<Champion | null>(null);

	const CHAMP_CACHE_PREFIX = 'ftds_champ_';

	async function fetchPreviousChampion(prevLeagueId: string, forLeagueId: string) {
		const cacheKey = `${CHAMP_CACHE_PREFIX}${forLeagueId}`;

		// Return cached result immediately if available
		try {
			const cached = sessionStorage.getItem(cacheKey);
			if (cached) {
				if (data.leagueId !== forLeagueId) return;
				champion = JSON.parse(cached);
				return;
			}
		} catch {}

		try {
			const [prevLeague, users, rosters, winners] = await Promise.all([
				fetchLeague(prevLeagueId),
				fetchUsers(prevLeagueId),
				fetchRosters(prevLeagueId),
				fetchWinnersBracket(prevLeagueId),
			]);

			// Discard if the user navigated away during fetch
			if (data.leagueId !== forLeagueId) return;
			if (!Array.isArray(winners) || winners.length === 0) return;

			const overrides = await fetchDisplayNameOverrides(users.map(u => u.user_id));
			const rosterInfo = buildRosterInfoMap(rosters, users, overrides);

			const maxRound = Math.max(...(winners as any[]).map((m: any) => m.r));
			const finalsMatch = (winners as any[]).find((m: any) => m.r === maxRound && m.t1_from?.w != null);
			if (!finalsMatch?.w) return;

			const info = rosterInfo.get(finalsMatch.w);

			const result: Champion = {
				teamName: info?.teamName ?? `Team ${finalsMatch.w}`,
				ownerName: info?.ownerName ?? null,
				avatar: info?.avatar ?? null,
				season: prevLeague.season,
			};

			champion = result;

			try {
				sessionStorage.setItem(cacheKey, JSON.stringify(result));
			} catch {}
		} catch {}
	}

	// Reacts to leagueId changes — covers both initial mount and year-switcher navigation
	$effect(() => {
		const leagueId = data.leagueId;

		loading = true;
		league = null;
		nflState = null;
		champion = null;

		Promise.all([
			fetchLeague(leagueId),
			fetchNflState(),
		]).then(([leagueData, nflData]: [SleeperLeague, SleeperNflState]) => {
			if (data.leagueId !== leagueId) return; // navigated away during fetch
			league = leagueData;
			nflState = nflData;
			loading = false;

			const prevId: string = leagueData.previous_league_id ?? '';
			if (prevId && prevId !== '0') {
				fetchPreviousChampion(prevId, leagueId);
			}
		});
	});

	const allNavItems = [
		{ href: 'standings',       label: 'Standings',        icon: '🏆' },
		{ href: 'matchups',        label: 'Matchups',         icon: '⚔️' },
		{ href: 'playoff-bracket', label: 'Playoff Bracket',  icon: '🎖️' },
		{ href: 'power-rankings',  label: 'Power Rankings',   icon: '📈' },
		{ href: 'rosters',         label: 'Rosters',          icon: '📋' },
		{ href: 'records',         label: 'Records',          icon: '📊' },
		{ href: 'transactions',    label: 'Transactions',     icon: '🔄' },
		{ href: 'drafts',          label: 'Drafts',           icon: '🎯' },
		{ href: 'awards',          label: 'Awards',           icon: '🥇' },
		{ href: 'managers',        label: 'Managers',         icon: '👤' },
		{ href: 'rivalry',         label: 'Rivalry',          icon: '⚡' },
		{ href: 'keepers',         label: 'Keepers',          icon: '🔒' },
		{ href: 'blog',            label: 'Blog',             icon: '📝' },
	];
	const navItems = $derived.by(() => {
		const enabled = data.enabledNavItems;
		const base = enabled && enabled.length > 0
			? enabled.map(href => allNavItems.find(n => n.href === href)).filter(Boolean) as typeof allNavItems
			: allNavItems;
		return base.filter(n => n.href !== 'blog' || data.hasBlog);
	});
</script>

{#if loading}
	<div class="space-y-4 animate-pulse">
		<div class="h-36 bg-navy-850 rounded-xl"></div>
		<div class="h-20 bg-navy-850/60 rounded-xl"></div>
		<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
			{#each Array(6) as _}
				<div class="h-24 bg-navy-850 rounded-lg"></div>
			{/each}
		</div>
	</div>
{:else if league}
	<!-- Hero banner -->
	<div class="relative rounded-xl overflow-hidden mb-4 border border-navy-700">
		<div class="absolute inset-0 bg-gradient-to-br from-navy-900 via-navy-850 to-navy-875"></div>
		<div class="absolute inset-0 bg-gradient-to-br from-amber-500/8 via-transparent to-orange-600/5 pointer-events-none"></div>
		<div class="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent"></div>

		<div class="relative p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5">
			{#if league.avatar}
				<img
					src="https://sleepercdn.com/avatars/thumbs/{league.avatar}"
					alt=""
					class="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover ring-2 ring-white/10 shrink-0"
				/>
			{:else}
				<div class="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-3xl shrink-0">
					🏈
				</div>
			{/if}

			<div class="min-w-0">
				<h1 class="font-sport font-black text-3xl sm:text-4xl uppercase tracking-tight text-white leading-tight truncate">{league.name}</h1>
				{#if nflState}
					<p class="text-slate-400 text-sm mt-1 font-medium">
						NFL {nflState.season}
						{#if nflState.season_type === 'pre'}&nbsp;· Preseason
						{:else if nflState.season_type === 'post'}&nbsp;· Postseason
						{:else}&nbsp;· Week {nflState.week}
						{/if}
					</p>
				{/if}
				<div class="flex items-center gap-2 mt-3 flex-wrap">
					<span class="inline-flex items-center bg-amber-500/10 text-amber-400 text-xs font-semibold px-2.5 py-1 rounded-full ring-1 ring-amber-500/20">
						{league.total_rosters} teams
					</span>
					<span class="inline-flex items-center bg-slate-800 text-slate-400 text-xs font-medium px-2.5 py-1 rounded-full">
						{league.settings?.type === 2 ? 'Dynasty' : 'Redraft'}
					</span>
					{#if nflState?.season_type === 'regular'}
						<span class="inline-flex items-center bg-green-500/10 text-green-400 text-xs font-medium px-2.5 py-1 rounded-full ring-1 ring-green-500/20">
							In Season
						</span>
					{:else if nflState?.season_type === 'post'}
						<span class="inline-flex items-center bg-amber-500/10 text-amber-400 text-xs font-medium px-2.5 py-1 rounded-full ring-1 ring-amber-500/20">
							Playoffs
						</span>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<!-- Reigning Champion banner -->
	{#if champion}
		<a
			href="/league/{data.leagueId}/awards"
			class="group relative flex items-center gap-4 rounded-xl overflow-hidden mb-6
			       border border-amber-500/25 hover:border-amber-400/40 transition-colors"
		>
			<div class="absolute inset-0 bg-slate-900"></div>
			<div class="absolute inset-0 bg-gradient-to-r from-amber-500/12 via-amber-500/5 to-transparent"></div>
			<div class="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent"></div>

			<div class="relative flex items-center gap-4 w-full px-5 py-4">
				<div class="shrink-0">
					<p class="text-xs font-bold uppercase tracking-[0.15em] text-amber-400/80 leading-none mb-1">
						{champion.season} Champion
					</p>
				</div>

				<div class="w-px h-8 bg-amber-500/20 shrink-0"></div>

				<div class="relative shrink-0">
					<div class="absolute inset-0 rounded-full blur-lg bg-amber-400/20 scale-[1.8]"></div>
					{#if champion.avatar}
						<img
							src={champion.avatar}
							alt=""
							class="relative w-11 h-11 rounded-full object-cover border-2 border-amber-400/70"
						/>
					{:else}
						<div class="relative w-11 h-11 rounded-full bg-slate-700 border-2 border-amber-400/70 flex items-center justify-center">
							🏈
						</div>
					{/if}
				</div>

				<div class="min-w-0 flex-1">
					<p class="font-black italic text-lg text-white leading-tight truncate group-hover:text-amber-100 transition-colors">
						{champion.teamName}
					</p>
					{#if champion.ownerName && champion.ownerName !== champion.teamName}
						<p class="text-slate-500 text-xs truncate">{champion.ownerName}</p>
					{/if}
				</div>

				<div class="shrink-0 flex items-center gap-2">
					<span class="text-2xl">🏆</span>
					<svg class="w-4 h-4 text-amber-500/50 group-hover:text-amber-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
					</svg>
				</div>
			</div>
		</a>
	{/if}

	<!-- Quick nav cards -->
	<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
		{#each navItems as nav}
			<a
				href="/league/{data.leagueId}/{nav.href}"
				class="group flex flex-col items-center justify-center gap-2.5 p-5 rounded-lg
				       bg-navy-850 border border-navy-700 hover:border-navy-600
				       hover:bg-navy-800 transition-all duration-150"
			>
				<span class="text-3xl group-hover:scale-110 transition-transform duration-150">{nav.icon}</span>
				<span class="font-sport font-bold uppercase text-xs tracking-wider text-navy-500 group-hover:text-white transition-colors">{nav.label}</span>
			</a>
		{/each}
	</div>
{/if}
