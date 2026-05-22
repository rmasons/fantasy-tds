<script lang="ts">
	import type { PageData } from './$types';
	import type { SleeperLeague, SleeperNflState } from '$lib/types';
	import { onMount } from 'svelte';

	let { data } = $props<{ data: PageData }>();

	let league = $state<SleeperLeague | null>(null);
	let nflState = $state<SleeperNflState | null>(null);
	let loading = $state(true);

	onMount(async () => {
		const [leagueRes, nflRes] = await Promise.all([
			fetch(`https://api.sleeper.app/v1/league/${data.leagueId}`),
			fetch('https://api.sleeper.app/v1/state/nfl')
		]);
		league = await leagueRes.json();
		nflState = await nflRes.json();
		loading = false;
	});
</script>

{#if loading}
	<p class="text-gray-400">Loading league…</p>
{:else if league}
	<div class="max-w-2xl mx-auto">
			<div class="flex items-center gap-4 mb-8">
				{#if league.avatar}
					<img
						src="https://sleepercdn.com/avatars/thumbs/{league.avatar}"
						alt=""
						class="w-16 h-16 rounded-full object-cover"
					/>
				{:else}
					<div class="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center text-2xl">
						🏈
					</div>
				{/if}
				<div>
					<h1 class="text-3xl font-bold">{league.name}</h1>
					{#if nflState}
						<p class="text-gray-400 text-sm">
							NFL {nflState.season}
							{#if nflState.season_type === 'pre'}Preseason
							{:else if nflState.season_type === 'post'}Postseason
							{:else}· Week {nflState.week}
							{/if}
						</p>
					{/if}
				</div>
			</div>

			<!-- Quick nav cards -->
			<div class="grid grid-cols-2 sm:grid-cols-3 gap-4">
				{#each [
					{ href: 'standings',    label: 'Standings',    icon: '🏆' },
					{ href: 'matchups',     label: 'Matchups',     icon: '⚔️' },
					{ href: 'rosters',      label: 'Rosters',      icon: '📋' },
					{ href: 'records',      label: 'Records',      icon: '📊' },
					{ href: 'transactions', label: 'Transactions', icon: '🔄' },
					{ href: 'drafts',       label: 'Drafts',       icon: '🎯' },
					{ href: 'awards',       label: 'Awards',       icon: '🥇' },
					{ href: 'managers',     label: 'Managers',     icon: '👤' },
					{ href: 'rivalry',      label: 'Rivalry',      icon: '⚡' },
					{ href: 'blog',         label: 'Blog',         icon: '📝' },
				] as nav}
					<a
						href="/league/{data.leagueId}/{nav.href}"
						class="flex flex-col items-center justify-center gap-2 p-5 rounded-xl
						       bg-gray-900 hover:bg-gray-800 transition-colors"
					>
						<span class="text-3xl">{nav.icon}</span>
						<span class="text-sm font-medium text-gray-200">{nav.label}</span>
					</a>
				{/each}
			</div>
	</div>
{/if}
