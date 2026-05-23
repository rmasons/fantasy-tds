<script lang="ts">
	import type { SleeperLeague } from '$lib/types';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	let { leagueId }: { leagueId: string } = $props();

	let league = $state<SleeperLeague | null>(null);
	let menuOpen = $state(false);
	let yearOpen = $state(false);

	interface SeasonEntry {
		leagueId: string;
		season: string;
	}
	let seasonChain = $state<SeasonEntry[]>([]);

	const CACHE_PREFIX = 'ftds_chain_';

	const navLinks = [
		{ href: 'standings',       label: 'Standings'       },
		{ href: 'matchups',        label: 'Matchups'        },
		{ href: 'playoff-bracket', label: 'Playoff Bracket' },
		{ href: 'power-rankings',  label: 'Power Rankings'  },
		{ href: 'rosters',         label: 'Rosters'         },
		{ href: 'records',         label: 'Records'         },
		{ href: 'transactions',    label: 'Transactions'    },
		{ href: 'drafts',          label: 'Drafts'          },
		{ href: 'awards',          label: 'Awards'          },
		{ href: 'managers',        label: 'Managers'        },
		{ href: 'rivalry',         label: 'Rivalry'         },
		{ href: 'blog',            label: 'Blog'            },
		{ href: 'keepers',         label: 'Keepers'         },
	];

	function currentSubPath(): string {
		const parts = page.url.pathname.split('/');
		const sub = parts.slice(3).join('/');
		return sub;
	}

	function switchSeason(targetId: string) {
		yearOpen = false;
		menuOpen = false;
		const sub = currentSubPath();
		goto(`/league/${targetId}${sub ? '/' + sub : ''}`);
	}

	function findCachedChain(): SeasonEntry[] | null {
		try {
			for (let i = 0; i < sessionStorage.length; i++) {
				const key = sessionStorage.key(i);
				if (!key?.startsWith(CACHE_PREFIX)) continue;
				const chain: SeasonEntry[] = JSON.parse(sessionStorage.getItem(key)!);
				if (chain.some(e => e.leagueId === leagueId)) return chain;
			}
		} catch {}
		return null;
	}

	onMount(async () => {
		const cached = findCachedChain();
		if (cached) seasonChain = cached;

		const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
		if (!res.ok) return;
		league = await res.json();

		if (!cached) {
			const chain: SeasonEntry[] = [{ leagueId, season: league!.season }];
			seasonChain = [...chain];

			let prevId: string = league!.previous_league_id ?? '';
			while (prevId && prevId !== '0') {
				const r = await fetch(`https://api.sleeper.app/v1/league/${prevId}`);
				if (!r.ok) break;
				const d: SleeperLeague = await r.json();
				chain.push({ leagueId: prevId, season: d.season });
				seasonChain = [...chain];
				prevId = d.previous_league_id ?? '';
			}

			try {
				sessionStorage.setItem(`${CACHE_PREFIX}${leagueId}`, JSON.stringify(chain));
			} catch {}
		}
	});

	const hasBlog = $derived(!!(page.data as any).hasBlog);
	const enabledNavItems = $derived((page.data as any).enabledNavItems as string[] | null);

	const visibleLinks = $derived(
		enabledNavItems && enabledNavItems.length > 0
			? enabledNavItems
				.map((href: string) => navLinks.find(l => l.href === href))
				.filter((l): l is { href: string; label: string } => !!l && (l.href !== 'blog' || hasBlog))
			: navLinks.filter(l => l.href !== 'blog' || hasBlog)
	);

	const currentSeason = $derived(
		seasonChain.find(e => e.leagueId === leagueId)?.season ?? league?.season ?? null
	);
	const hasHistory = $derived(seasonChain.length > 1);

	function isActive(href: string) {
		return page.url.pathname.startsWith(`/league/${leagueId}/${href}`);
	}

	async function signOut() {
		await fetch('/api/auth/session', { method: 'DELETE' });
		window.location.href = '/login';
	}
</script>

<svelte:document onclick={(e) => {
	if (yearOpen && !(e.target as Element)?.closest?.('.year-selector')) yearOpen = false;
}} />

<!-- ─── Desktop sidebar (lg+) ─────────────────────────────────── -->
<aside class="hidden lg:flex flex-col fixed inset-y-0 left-0 w-56 bg-navy-900 border-r border-navy-700 z-40">

	<!-- League header -->
	<div class="p-4 border-b border-navy-700">
		<a href="/league/{leagueId}" class="flex items-center gap-2.5 min-w-0 group mb-3">
			{#if league?.avatar}
				<img
					src="https://sleepercdn.com/avatars/thumbs/{league.avatar}"
					alt=""
					class="w-8 h-8 rounded-full object-cover shrink-0 ring-2 ring-slate-700 group-hover:ring-blue-500 transition-all"
				/>
			{:else}
				<div class="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shrink-0 text-sm">
					🏈
				</div>
			{/if}
			<span class="font-bold text-white text-sm truncate leading-tight group-hover:text-blue-400 transition-colors">
				{league?.name ?? '…'}
			</span>
		</a>

		<!-- Year selector -->
		{#if currentSeason}
			<div class="year-selector relative">
				<button
					onclick={() => (yearOpen = !yearOpen)}
					disabled={!hasHistory}
					class="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-md text-xs transition-colors
					       {hasHistory
					           ? 'text-slate-400 hover:text-white hover:bg-navy-800 cursor-pointer'
					           : 'text-navy-500 cursor-default'}"
					title={hasHistory ? 'Switch season' : 'Only one season available'}
				>
					<span class="text-slate-600 font-medium">Season</span>
					<span class="font-semibold text-slate-300">{currentSeason}</span>
					{#if hasHistory}
						<svg class="w-3 h-3 ml-auto shrink-0 transition-transform {yearOpen ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
						</svg>
					{/if}
				</button>

				{#if yearOpen && hasHistory}
					<div class="absolute left-0 top-full mt-1 bg-navy-800 border border-navy-700 rounded-lg shadow-2xl overflow-hidden z-50 min-w-full">
						{#each seasonChain as entry}
							<button
								onclick={() => switchSeason(entry.leagueId)}
								class="w-full text-left px-3 py-2 text-sm transition-colors
								       {entry.leagueId === leagueId
								           ? 'bg-amber-500 text-slate-950 font-bold'
								           : 'text-slate-300 hover:bg-navy-700'}"
							>
								{entry.season}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Nav links -->
	<nav class="flex-1 p-2 space-y-0.5 overflow-y-auto">
		{#each visibleLinks as link}
			<a
				href="/league/{leagueId}/{link.href}"
				class="flex items-center px-3 py-2 rounded-lg text-sm transition-all
				       {isActive(link.href)
				           ? 'bg-amber-500/10 border-l-2 border-amber-400 text-amber-50 font-semibold pl-[10px]'
				           : 'text-slate-400 hover:text-white hover:bg-white/[0.05] border-l-2 border-transparent'}"
			>
				{link.label}
			</a>
		{/each}
	</nav>

	<!-- Bottom auth -->
	<div class="p-2 border-t border-navy-700 space-y-0.5">
		{#if page.data.user}
			{#if page.data.user.sleeperUserId}
				<a
					href="/settings/profile?leagueId={leagueId}"
					class="flex items-center px-3 py-2 rounded-lg text-xs text-navy-500 hover:text-slate-300 hover:bg-navy-800 transition-colors"
				>
					Edit my profile
				</a>
			{/if}
			{#if page.data.user.isAdmin}
				<a
					href="/league/{leagueId}/admin"
					class="flex items-center px-3 py-2 rounded-lg text-xs text-navy-500 hover:text-slate-300 hover:bg-navy-800 transition-colors
					       {isActive('admin') ? 'text-amber-400' : ''}"
				>
					League admin
				</a>
			{/if}
			<a
				href="/"
				class="flex items-center px-3 py-2 rounded-lg text-xs text-navy-500 hover:text-slate-300 hover:bg-navy-800 transition-colors"
			>
				Switch league
			</a>
			<button
				onclick={signOut}
				class="w-full text-left px-3 py-2 rounded-lg text-xs text-navy-500 hover:text-red-400 hover:bg-navy-800/60 transition-colors"
			>
				Sign out
			</button>
		{:else}
			<a
				href="/login"
				class="flex items-center px-3 py-2 rounded-lg text-xs text-navy-500 hover:text-slate-300 hover:bg-navy-800 transition-colors"
			>
				Sign in
			</a>
		{/if}
	</div>
</aside>

<!-- ─── Mobile top nav (<lg) ──────────────────────────────────── -->
<nav class="lg:hidden bg-navy-900 border-b border-navy-700 sticky top-0 z-50">
	<div class="max-w-7xl mx-auto px-4 flex items-center h-14 gap-3">

		<!-- League name / home link -->
		<a href="/league/{leagueId}" class="flex items-center gap-2 shrink-0">
			{#if league?.avatar}
				<img
					src="https://sleepercdn.com/avatars/thumbs/{league.avatar}"
					alt=""
					class="w-7 h-7 rounded-full object-cover"
				/>
			{:else}
				<span class="text-lg">🏈</span>
			{/if}
			<span class="font-semibold text-white text-sm hidden sm:block truncate max-w-[140px]">
				{league?.name ?? '…'}
			</span>
		</a>

		<!-- Year selector (mobile) -->
		{#if currentSeason}
			<div class="year-selector relative shrink-0">
				<button
					onclick={() => (yearOpen = !yearOpen)}
					class="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
					       {hasHistory
					           ? 'bg-navy-800 hover:bg-navy-700 text-slate-300 cursor-pointer'
					           : 'bg-navy-800/50 text-navy-500 cursor-default'}"
					disabled={!hasHistory}
					title={hasHistory ? 'Switch season' : 'Only one season available'}
				>
					{currentSeason}
					{#if hasHistory}
						<svg class="w-3 h-3 transition-transform {yearOpen ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
						</svg>
					{/if}
				</button>

				{#if yearOpen && hasHistory}
					<div class="absolute left-0 top-full mt-1 bg-navy-800 border border-navy-700 rounded-lg shadow-xl overflow-hidden z-50 min-w-[100px]">
						{#each seasonChain as entry}
							<button
								onclick={() => switchSeason(entry.leagueId)}
								class="w-full text-left px-4 py-2 text-sm transition-colors
								       {entry.leagueId === leagueId
								           ? 'bg-amber-500 text-slate-950 font-bold'
								           : 'text-slate-300 hover:bg-navy-700'}"
							>
								{entry.season}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Right side -->
		<div class="ml-auto flex items-center gap-2 shrink-0">
			{#if page.data.user}
				<a
					href="/"
					class="text-xs text-slate-500 hover:text-slate-300 transition-colors hidden sm:block whitespace-nowrap"
				>
					Switch league
				</a>
				<button
					onclick={signOut}
					class="text-xs text-slate-500 hover:text-red-400 transition-colors"
				>
					Sign out
				</button>
			{:else}
				<a
					href="/login"
					class="text-xs text-slate-500 hover:text-slate-300 transition-colors"
				>
					Sign in
				</a>
			{/if}

			<!-- Hamburger -->
			<button
				onclick={() => (menuOpen = !menuOpen)}
				class="md:hidden p-1.5 rounded text-slate-400 hover:text-white"
				aria-label="Toggle menu"
			>
				{#if menuOpen}✕{:else}☰{/if}
			</button>
		</div>
	</div>

	<!-- Mobile dropdown -->
	{#if menuOpen}
		<div class="md:hidden bg-navy-900 border-t border-navy-700 px-4 py-3 flex flex-col gap-1">
			{#if hasHistory}
				<div class="mb-2 pb-2 border-b border-navy-700">
					<p class="text-[10px] text-navy-500 uppercase tracking-widest mb-1.5 px-1">Season</p>
					<div class="flex flex-wrap gap-1">
						{#each seasonChain as entry}
							<button
								onclick={() => switchSeason(entry.leagueId)}
								class="px-3 py-1 rounded-lg text-xs font-medium transition-colors
								       {entry.leagueId === leagueId
								           ? 'bg-amber-500 text-slate-950 font-bold'
								           : 'bg-navy-800 text-slate-300 hover:bg-navy-700'}"
							>
								{entry.season}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#each visibleLinks as link}
				<a
					href="/league/{leagueId}/{link.href}"
					onclick={() => (menuOpen = false)}
					class="px-3 py-2 rounded-md text-sm transition-colors
					       {isActive(link.href)
					           ? 'bg-amber-500/15 text-amber-50 font-semibold border-l-2 border-amber-400 pl-[10px]'
					           : 'text-slate-300 hover:bg-white/[0.05]'}"
				>
					{link.label}
				</a>
			{/each}

			<div class="border-t border-navy-700 mt-2 pt-2 flex flex-wrap gap-4">
				{#if page.data.user}
					{#if page.data.user.sleeperUserId}
						<a href="/settings/profile?leagueId={leagueId}" onclick={() => (menuOpen = false)} class="text-xs text-navy-500 hover:text-slate-300">Edit profile</a>
					{/if}
					{#if page.data.user.isAdmin}
						<a href="/league/{leagueId}/admin" onclick={() => (menuOpen = false)} class="text-xs text-navy-500 hover:text-slate-300">League admin</a>
					{/if}
					<a href="/" class="text-xs text-navy-500 hover:text-slate-300">Switch league</a>
					<button onclick={signOut} class="text-xs text-navy-500 hover:text-red-400">Sign out</button>
				{:else}
					<a href="/login" class="text-xs text-navy-500 hover:text-slate-300">Sign in</a>
				{/if}
			</div>
		</div>
	{/if}
</nav>
