<script lang="ts">
	import type { SleeperLeague } from '$lib/types';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	let { leagueId }: { leagueId: string } = $props();

	let league = $state<SleeperLeague | null>(null);
	let menuOpen = $state(false);

	const navLinks = [
		{ href: 'standings',       label: 'Standings'       },
		{ href: 'matchups',        label: 'Matchups'        },
		{ href: 'power-rankings',  label: 'Power Rankings'  },
		{ href: 'rosters',         label: 'Rosters'         },
		{ href: 'history',         label: 'Awards & Records' },
		{ href: 'transactions',    label: 'Transactions'    },
		{ href: 'trades',          label: 'Trade Analytics' },
		{ href: 'drafts',          label: 'Drafts'          },
		{ href: 'superlatives',    label: 'Superlatives'    },
		{ href: 'managers',        label: 'Managers'        },
		{ href: 'rivalry',         label: 'Rivalry'         },
		{ href: 'blog',            label: 'Blog'            },
		{ href: 'keepers',         label: 'Keepers'         },
		{ href: 'faab',            label: 'FAAB Ledger'     },
		{ href: 'tiers',           label: 'Tiers'           },
	];

	onMount(async () => {
		const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
		if (!res.ok) return;
		league = await res.json();
	});

	const hasBlog = $derived(!!(page.data as any).hasBlog);
	const isPremier = $derived(!!(page.data as any).isPremier);
	const enabledNavItems = $derived((page.data as any).enabledNavItems as string[] | null);

	// Same shape as the blog gate: 'tiers' only shows for the premier ruleset,
	// 'blog' only shows when Contentful is configured — both independent of
	// whether the admin has customized the nav order.
	const navVisible = (href: string) => (href !== 'blog' || hasBlog) && (href !== 'tiers' || isPremier);

	const visibleLinks = $derived(
		enabledNavItems && enabledNavItems.length > 0
			? enabledNavItems
				.map((href: string) => navLinks.find(l => l.href === href))
				.filter((l): l is { href: string; label: string } => !!l && navVisible(l.href))
			: navLinks.filter(l => navVisible(l.href))
	);

	const bottomTabDefs = [
		{ href: 'standings', label: 'Standings', emoji: '🏆' },
		{ href: 'matchups',  label: 'Matchups',  emoji: '⚔️' },
		{ href: 'history',   label: 'Records',   emoji: '📊' },
		{ href: 'rosters',   label: 'Rosters',   emoji: '📋' },
	];
	const bottomTabs = $derived(
		bottomTabDefs.filter(t => visibleLinks.some(l => l.href === t.href))
	);

	function isActive(href: string) {
		return page.url.pathname.startsWith(`/league/${leagueId}/${href}`);
	}

	async function signOut() {
		await fetch('/api/auth/session', { method: 'DELETE' });
		window.location.href = '/login';
	}
</script>


<!-- ─── Desktop sidebar (lg+) ─────────────────────────────────── -->
<aside class="hidden lg:flex flex-col fixed inset-y-0 left-0 w-56 bg-navy-900 border-r border-navy-700 z-40">

	<!-- League header -->
	<div class="p-4 border-b border-navy-700">
		<a href="/league/{leagueId}" class="flex items-center gap-2.5 min-w-0 group mb-3">
			{#if league?.avatar}
				<img
					src="https://sleepercdn.com/avatars/thumbs/{league.avatar}"
					alt=""
					class="w-8 h-8 rounded-full object-cover shrink-0 ring-2 ring-white/10 group-hover:ring-amber-400/50 transition-all"
				/>
			{:else}
				<div class="w-8 h-8 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shrink-0 text-sm">
					🏈
				</div>
			{/if}
			<span class="font-bold text-white text-sm truncate leading-tight group-hover:text-amber-300 transition-colors">
				{league?.name ?? '…'}
			</span>
		</a>

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
				class="block w-full px-3 py-2.5 rounded-lg text-sm font-bold text-center bg-amber-500 hover:bg-amber-400 text-navy-900 transition-colors"
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
			<span class="font-semibold text-white text-sm truncate max-w-[140px]">
				{league?.name ?? '…'}
			</span>
		</a>

		<!-- Right side -->
		<div class="ml-auto flex items-center shrink-0">
			<button
				onclick={() => (menuOpen = !menuOpen)}
				class="flex items-center justify-center w-10 h-10 rounded-lg transition-colors
				       {menuOpen ? 'text-amber-400 bg-amber-400/10' : 'text-slate-400 hover:text-white hover:bg-white/[0.05]'}"
				aria-label="Toggle navigation"
			>
				<span class="text-xl leading-none">☰</span>
			</button>
		</div>
	</div>

	<!-- Mobile dropdown -->
	{#if menuOpen}
		<div class="lg:hidden bg-navy-900 border-t border-navy-700 px-4 py-3 flex flex-col gap-1">
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
					<a
						href="/login"
						class="w-full px-4 py-3 rounded-lg text-sm font-bold text-center bg-amber-500 hover:bg-amber-400 text-navy-900 transition-colors"
					>
						Sign in
					</a>
				{/if}
			</div>
		</div>
	{/if}
</nav>

<!-- ─── Bottom tab bar (mobile <lg) ─────────────────────────── -->
{#if bottomTabs.length > 0}
	<nav
		class="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-navy-900 border-t border-white/[0.07]"
		style="padding-bottom: env(safe-area-inset-bottom)"
	>
		{#if !page.data.user}
			<div class="px-4 py-2 border-b border-white/[0.07]">
				<a
					href="/login"
					class="w-full block px-4 py-2.5 rounded-lg text-sm font-bold text-center bg-amber-500 hover:bg-amber-400 text-navy-900 transition-colors"
				>
					Sign in
				</a>
			</div>
		{/if}
		<div class="grid h-14" style="grid-template-columns: repeat({bottomTabs.length}, 1fr)">
			{#each bottomTabs as tab}
				<a
					href="/league/{leagueId}/{tab.href}"
					class="flex flex-col items-center justify-center gap-0.5 transition-colors
					       {isActive(tab.href)
					           ? 'text-amber-400'
					           : 'text-navy-500 hover:text-slate-300'}"
				>
					<span class="text-xl leading-none">{tab.emoji}</span>
					<span class="text-[9px] font-bold uppercase tracking-wider">{tab.label}</span>
				</a>
			{/each}
		</div>
	</nav>
{/if}
