<script lang="ts">
	import type { PageData } from './$types';
	import type { SleeperLeague, SleeperNflState } from '$lib/types';
	import FaabEasterEgg from '$lib/components/FaabEasterEgg.svelte';
	import {
		fetchLeague, fetchNflState, fetchUsers, fetchRosters, fetchWinnersBracket,
		buildRosterInfoMap, fetchDisplayNameOverrides, fetchLeagueCore, fetchMatchups, combineFpts,
	} from '$lib/sleeper';

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

	interface StandingMini {
		rank: number;
		teamName: string;
		ownerName: string | null;
		avatar: string | null;
		wins: number;
		losses: number;
		fpts: number;
	}

	interface MatchupWidget {
		matchupId: number;
		teams: { teamName: string; avatar: string | null; points: number }[];
	}

	let standingsMini = $state<StandingMini[]>([]);
	let standingsLoading = $state(false);
	let weekMatchups = $state<MatchupWidget[]>([]);
	let matchupsLoading = $state(false);

	const CHAMP_CACHE_PREFIX = 'ftds_champ_';

	async function fetchPreviousChampion(prevLeagueId: string, forLeagueId: string) {
		const cacheKey = `${CHAMP_CACHE_PREFIX}${forLeagueId}`;
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
			try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch {}
		} catch {}
	}

	async function loadWidgets(leagueId: string, nflData: SleeperNflState) {
		standingsLoading = true;
		matchupsLoading = nflData.season_type === 'regular';
		standingsMini = [];
		weekMatchups = [];

		try {
			const [core, rawMatchups] = await Promise.all([
				fetchLeagueCore(leagueId),
				nflData.season_type === 'regular'
					? fetchMatchups(leagueId, nflData.week).catch(() => [])
					: Promise.resolve([]),
			]);
			if (data.leagueId !== leagueId) return;

			const overrides = await fetchDisplayNameOverrides(core.users.map(u => u.user_id));
			if (data.leagueId !== leagueId) return;

			const rosterInfo = buildRosterInfoMap(core.rosters, core.users, overrides);

			// Build standings mini
			const rows: StandingMini[] = core.rosters.map(r => {
				const info = rosterInfo.get(r.roster_id)!;
				return {
					rank: 0,
					teamName: info.teamName,
					ownerName: info.ownerName,
					avatar: info.avatar,
					wins: r.settings.wins ?? 0,
					losses: r.settings.losses ?? 0,
					fpts: combineFpts(r.settings.fpts, r.settings.fpts_decimal),
				};
			});
			rows.sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);
			rows.forEach((r, i) => r.rank = i + 1);
			standingsMini = rows;

			// Build matchup widgets
			if (rawMatchups.length > 0) {
				const groups = new Map<number, { teamName: string; avatar: string | null; points: number }[]>();
				for (const m of rawMatchups) {
					if (!groups.has(m.matchup_id)) groups.set(m.matchup_id, []);
					const info = rosterInfo.get(m.roster_id);
					groups.get(m.matchup_id)!.push({
						teamName: info?.teamName ?? `Team ${m.roster_id}`,
						avatar: info?.avatar ?? null,
						points: m.points ?? 0,
					});
				}
				weekMatchups = [...groups.entries()]
					.filter(([, pair]) => pair.length === 2)
					.map(([mid, teams]) => ({ matchupId: mid, teams }))
					.sort((a, b) => a.matchupId - b.matchupId);
			}
		} catch {
			// widget failures are non-critical
		} finally {
			if (data.leagueId === leagueId) {
				standingsLoading = false;
				matchupsLoading = false;
			}
		}
	}

	$effect(() => {
		const leagueId = data.leagueId;

		loading = true;
		league = null;
		nflState = null;
		champion = null;
		standingsMini = [];
		standingsLoading = false;
		weekMatchups = [];
		matchupsLoading = false;

		Promise.all([
			fetchLeague(leagueId),
			fetchNflState(),
		]).then(([leagueData, nflData]: [SleeperLeague, SleeperNflState]) => {
			if (data.leagueId !== leagueId) return;
			league = leagueData;
			nflState = nflData;
			loading = false;

			const prevId: string = leagueData.previous_league_id ?? '';
			if (prevId && prevId !== '0') {
				fetchPreviousChampion(prevId, leagueId);
			}

			loadWidgets(leagueId, nflData);
		});
	});

	const allNavItems = [
		{ href: 'standings',       label: 'Standings',        icon: '🏆' },
		{ href: 'matchups',        label: 'Matchups',         icon: '⚔️' },
		{ href: 'power-rankings',  label: 'Power Rankings',   icon: '📈' },
		{ href: 'rosters',         label: 'Rosters',          icon: '📋' },
		{ href: 'history',         label: 'Awards & Records', icon: '📊' },
		{ href: 'transactions',    label: 'Transactions',     icon: '🔄' },
		{ href: 'drafts',          label: 'Drafts',           icon: '🎯' },
		{ href: 'superlatives',    label: 'Superlatives',     icon: '🏅' },
		{ href: 'managers',        label: 'Managers',         icon: '👤' },
		{ href: 'rivalry',         label: 'Rivalry',          icon: '⚡' },
		{ href: 'blog',            label: 'Blog',             icon: '📝' },
		{ href: 'keepers',         label: 'Keepers',          icon: '🔒' },
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
			href="/league/{data.leagueId}/history"
			class="group relative flex items-center gap-4 rounded-xl overflow-hidden mb-4
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

	<!-- Week matchups widget (regular season only) -->
	{#if matchupsLoading}
		<div class="mb-6">
			<div class="h-4 w-32 bg-navy-850 rounded animate-pulse mb-3"></div>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				{#each Array(5) as _}
					<div class="h-20 bg-navy-850 rounded-lg animate-pulse"></div>
				{/each}
			</div>
		</div>
	{:else if weekMatchups.length > 0}
		<div class="mb-6">
			<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-3 flex items-center gap-2">
				<span class="text-amber-400">◆</span>Week {nflState?.week} Matchups<FaabEasterEgg eggId="12" leagueId={data.leagueId} loggedIn={!!data.user} />
			</h2>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				{#each weekMatchups as matchup}
					<a
						href="/league/{data.leagueId}/matchups"
						class="bg-navy-850 rounded-lg border border-navy-700 hover:border-navy-600 px-4 py-3 transition-colors block"
					>
						{#each matchup.teams as team, i}
							{#if i === 1}
								<div class="my-2 border-t border-navy-700/50"></div>
							{/if}
							<div class="flex items-center gap-2.5">
								{#if team.avatar}
									<img src={team.avatar} alt="" class="w-7 h-7 rounded-full shrink-0 object-cover" />
								{:else}
									<div class="w-7 h-7 rounded-full bg-navy-800 flex items-center justify-center text-sm shrink-0">🏈</div>
								{/if}
								<span class="flex-1 text-sm text-white truncate">{team.teamName}</span>
								<span class="text-sm font-mono font-semibold tabular-nums shrink-0
								             {team.points > 0 ? 'text-amber-300' : 'text-navy-600'}">
									{team.points > 0 ? team.points.toFixed(2) : '—'}
								</span>
							</div>
						{/each}
					</a>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Standings mini widget -->
	{#if standingsLoading}
		<div class="bg-navy-850 rounded-xl border border-navy-700 animate-pulse mb-6 h-64"></div>
	{:else if standingsMini.length > 0}
		<div class="bg-navy-850 rounded-xl border border-navy-700 overflow-hidden mb-6">
			<div class="flex items-center justify-between px-4 py-3 border-b border-navy-700">
				<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 flex items-center gap-2">
					<span class="text-amber-400">◆</span>Standings
				</h2>
				<a href="/league/{data.leagueId}/standings" class="text-xs text-navy-500 hover:text-amber-400 transition-colors">
					Full →
				</a>
			</div>
			{#each standingsMini.slice(0, league?.settings?.playoff_teams ?? standingsMini.length) as row}
				<div class="flex items-center gap-3 px-4 py-2.5 border-b border-navy-700/40 last:border-b-0 hover:bg-navy-800/30 transition-colors">
					<span class="text-[11px] font-mono w-4 text-center shrink-0
					             {row.rank === 1 ? 'text-amber-400 font-bold' : row.rank <= 3 ? 'text-slate-300' : 'text-navy-600'}">
						{row.rank}
					</span>
					{#if row.avatar}
						<img src={row.avatar} alt="" class="w-7 h-7 rounded-full object-cover shrink-0" />
					{:else}
						<div class="w-7 h-7 rounded-full bg-navy-800 flex items-center justify-center shrink-0 text-sm">🏈</div>
					{/if}
					<div class="flex-1 min-w-0">
						<p class="text-sm text-white truncate leading-tight">{row.teamName}</p>
						{#if row.ownerName && row.ownerName !== row.teamName}
							<p class="text-[11px] text-navy-500 truncate leading-tight">{row.ownerName}</p>
						{/if}
					</div>
					<span class="text-xs font-mono tabular-nums text-slate-400 shrink-0">{row.wins}–{row.losses}</span>
					<span class="text-xs font-mono tabular-nums text-navy-600 w-16 text-right shrink-0">{row.fpts.toFixed(1)} pts</span>
				</div>
			{/each}
		</div>
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
