<script lang="ts">
	import type { PageData } from './$types';
	import type { ManagerProfile } from '$lib/types';
	import type { ManagerCard } from '$lib/server/managers';
	import FaabEasterEgg from '$lib/components/FaabEasterEgg.svelte';

	let { data } = $props<{ data: PageData }>();

	let managers = $state<ManagerCard[]>(data.managers);
	let profiles = $state<Record<string, ManagerProfile>>({});
	let loading = $state(false);
	let error = $state(data.loadFailed ? 'Failed to load managers.' : '');

	$effect(() => {
		const leagueId = data.leagueId;
		managers = data.managers;
		error = data.loadFailed ? 'Failed to load managers.' : '';
		profiles = {};

		// Enrich with manager profiles via our own gated endpoint (not Sleeper).
		if (data.managers.length) {
			const ids = data.managers.map((m: ManagerCard) => m.userId).join(',');
			fetch(`/api/profiles?ids=${ids}&leagueId=${leagueId}`)
				.then((r) => r.json())
				.then((p) => {
					if (data.leagueId === leagueId) profiles = p;
				})
				.catch(() => {});
		}
	});
</script>

<div>
	<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none mb-6">Managers</h1>

	{#if loading}
		<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each Array(6) as _}
				<div class="h-28 bg-navy-850 rounded-lg animate-pulse"></div>
			{/each}
		</div>
	{:else if error}
		<p class="text-red-400">Failed to load managers: {error}</p>
	{:else if managers.length === 0}
		<p class="text-navy-500">No managers found.</p>
	{:else}
		<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each managers as mgr}
				{@const profile = profiles[mgr.userId]}
				{@const realName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ')}
				<a
					href="/league/{data.leagueId}/managers/{mgr.userId}"
					class="bg-navy-850 rounded-lg border border-navy-700 hover:border-navy-600 hover:bg-navy-800 transition-colors p-4 flex gap-4 items-start"
				>
					{#if mgr.avatar}
						<img src={mgr.avatar} alt="" class="w-12 h-12 rounded-full object-cover shrink-0 mt-0.5" />
					{:else}
						<div class="w-12 h-12 rounded-full bg-navy-800 flex items-center justify-center text-xl shrink-0 mt-0.5">🏈</div>
					{/if}
					<div class="min-w-0 flex-1">
						<p class="font-semibold text-white leading-snug line-clamp-2">{mgr.teamName}</p>
						<p class="text-xs text-navy-500 truncate mt-0.5">{realName || mgr.displayName}</p>
						<div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1">
							<span class="text-xs text-slate-400 tabular-nums">
								{mgr.wins}–{mgr.losses}{mgr.ties ? `–${mgr.ties}` : ''}
							</span>
							<span class="text-xs text-navy-500 tabular-nums">{mgr.fpts.toFixed(1)} pts</span>
						</div>
						{#if profile?.bio}
							<p class="text-xs text-navy-500 mt-1.5 line-clamp-2 leading-relaxed">{profile.bio}</p>
						{/if}
						{#if profile?.location || profile?.favoriteNFLTeam}
							<div class="flex flex-wrap gap-1.5 mt-1.5">
								{#if profile.location}
									<span class="text-[11px] text-navy-500 bg-navy-800 rounded px-2 py-0.5">{profile.location}</span>
								{/if}
								{#if profile.favoriteNFLTeam}
									<span class="text-[11px] text-navy-500 bg-navy-800 rounded px-2 py-0.5">{profile.favoriteNFLTeam}</span>
								{/if}
							</div>
						{/if}
					</div>
				</a>
			{/each}
		</div>
		<p class="mt-3 text-right text-[10px] text-navy-800 select-none">sorted by all-time record<FaabEasterEgg eggId="10" leagueId={data.leagueId} loggedIn={!!data.user} /></p>
	{/if}
</div>
