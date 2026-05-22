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
		{ href: 'standings',    label: 'Standings'    },
		{ href: 'matchups',     label: 'Matchups'     },
		{ href: 'rosters',      label: 'Rosters'      },
		{ href: 'records',      label: 'Records'      },
		{ href: 'transactions', label: 'Transactions' },
		{ href: 'drafts',       label: 'Drafts'       },
		{ href: 'awards',       label: 'Awards'       },
		{ href: 'managers',     label: 'Managers'     },
		{ href: 'rivalry',      label: 'Rivalry'      },
		{ href: 'blog',         label: 'Blog'         },
	];

	function currentSubPath(): string {
		const parts = page.url.pathname.split('/');
		// ['',' league', leagueId, 'sub', 'path']
		const sub = parts.slice(3).join('/');
		return sub;
	}

	function switchSeason(targetId: string) {
		yearOpen = false;
		menuOpen = false;
		const sub = currentSubPath();
		goto(`/league/${targetId}${sub ? '/' + sub : ''}`);
	}

	// Find a cached chain that contains leagueId anywhere in it
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
		// Warm chain from cache so year selector appears instantly
		const cached = findCachedChain();
		if (cached) seasonChain = cached;

		// Fetch current league for name/avatar
		const res = await fetch(`https://api.sleeper.app/v1/league/${leagueId}`);
		league = await res.json();

		if (!cached) {
			// Walk the previous_league_id chain progressively
			const chain: SeasonEntry[] = [{ leagueId, season: league!.season }];
			seasonChain = [...chain];

			let prevId: string = league!.previous_league_id ?? '';
			while (prevId && prevId !== '0') {
				const r = await fetch(`https://api.sleeper.app/v1/league/${prevId}`);
				const d: SleeperLeague = await r.json();
				chain.push({ leagueId: prevId, season: d.season });
				seasonChain = [...chain]; // update reactively as each season loads
				prevId = d.previous_league_id ?? '';
			}

			try {
				// Cache under the current (newest) leagueId as the key
				// This lets future navigation into historical seasons find this chain
				sessionStorage.setItem(`${CACHE_PREFIX}${leagueId}`, JSON.stringify(chain));
			} catch {}
		}
	});

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

<svelte:document onclick={(e) => { if (yearOpen && !(e.target as Element)?.closest?.('.year-selector')) yearOpen = false; }} />

<nav class="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
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

		<!-- Time machine year selector -->
		{#if currentSeason}
			<div class="year-selector relative shrink-0">
				<button
					onclick={() => (yearOpen = !yearOpen)}
					class="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
					       {hasHistory
					           ? 'bg-gray-800 hover:bg-gray-700 text-gray-300 cursor-pointer'
					           : 'bg-gray-800/50 text-gray-500 cursor-default'}"
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
					<div class="absolute left-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-xl shadow-xl overflow-hidden z-50 min-w-[100px]">
						{#each seasonChain as entry}
							<button
								onclick={() => switchSeason(entry.leagueId)}
								class="w-full text-left px-4 py-2 text-sm transition-colors
								       {entry.leagueId === leagueId
								           ? 'bg-blue-600 text-white font-semibold'
								           : 'text-gray-300 hover:bg-gray-700'}"
							>
								{entry.season}
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<!-- Desktop nav links -->
		<div class="hidden md:flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-none">
			{#each navLinks as link}
				<a
					href="/league/{leagueId}/{link.href}"
					class="px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors shrink-0
					       {isActive(link.href)
					           ? 'bg-blue-600 text-white'
					           : 'text-gray-400 hover:text-white hover:bg-gray-800'}"
				>
					{link.label}
				</a>
			{/each}
		</div>

		<!-- Right side -->
		<div class="ml-auto flex items-center gap-2 shrink-0">
			{#if page.data.user}
				<a
					href="/"
					class="text-xs text-gray-500 hover:text-gray-300 transition-colors hidden sm:block whitespace-nowrap"
				>
					Switch league
				</a>
				<button
					onclick={signOut}
					class="text-xs text-gray-500 hover:text-red-400 transition-colors"
				>
					Sign out
				</button>
			{:else}
				<a
					href="/login"
					class="text-xs text-gray-500 hover:text-gray-300 transition-colors"
				>
					Sign in
				</a>
			{/if}

			<!-- Mobile hamburger -->
			<button
				onclick={() => (menuOpen = !menuOpen)}
				class="md:hidden p-1.5 rounded text-gray-400 hover:text-white"
				aria-label="Toggle menu"
			>
				{#if menuOpen}✕{:else}☰{/if}
			</button>
		</div>
	</div>

	<!-- Mobile dropdown -->
	{#if menuOpen}
		<div class="md:hidden bg-gray-900 border-t border-gray-800 px-4 py-3 flex flex-col gap-1">
			<!-- Season selector in mobile menu -->
			{#if hasHistory}
				<div class="mb-2 pb-2 border-b border-gray-800">
					<p class="text-xs text-gray-600 uppercase tracking-wider mb-1.5 px-1">Season</p>
					<div class="flex flex-wrap gap-1">
						{#each seasonChain as entry}
							<button
								onclick={() => switchSeason(entry.leagueId)}
								class="px-3 py-1 rounded-lg text-xs font-medium transition-colors
								       {entry.leagueId === leagueId
								           ? 'bg-blue-600 text-white'
								           : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}"
							>
								{entry.season}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#each navLinks as link}
				<a
					href="/league/{leagueId}/{link.href}"
					onclick={() => (menuOpen = false)}
					class="px-3 py-2 rounded-md text-sm transition-colors
					       {isActive(link.href)
					           ? 'bg-blue-600 text-white'
					           : 'text-gray-300 hover:bg-gray-800'}"
				>
					{link.label}
				</a>
			{/each}
			<div class="border-t border-gray-800 mt-2 pt-2 flex gap-4">
				{#if page.data.user}
					<a href="/" class="text-xs text-gray-500 hover:text-gray-300">Switch league</a>
					<button onclick={signOut} class="text-xs text-gray-500 hover:text-red-400">Sign out</button>
				{:else}
					<a href="/login" class="text-xs text-gray-500 hover:text-gray-300">Sign in</a>
				{/if}
			</div>
		</div>
	{/if}
</nav>
