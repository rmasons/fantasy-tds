<script lang="ts">
	import type { PageData } from './$types';
	import type { SleeperRoster, SleeperLeagueUser } from '$lib/types';
	import { onMount } from 'svelte';

	let { data } = $props<{ data: PageData }>();

	interface ManagerCard {
		userId: string;
		displayName: string;
		teamName: string;
		avatar: string | null;
		rosterId: number;
		wins: number;
		losses: number;
		ties: number;
		fpts: number;
		fptsAgainst: number;
	}

	let managers = $state<ManagerCard[]>([]);
	let loading = $state(true);
	let error = $state('');

	onMount(async () => {
		try {
			const [rostersRes, usersRes] = await Promise.all([
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/rosters`),
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/users`),
			]);
			const [rosters, users]: [SleeperRoster[], SleeperLeagueUser[]] = await Promise.all([
				rostersRes.json(), usersRes.json()
			]);

			const userMap = new Map<string, SleeperLeagueUser>(users.map(u => [u.user_id, u]));

			managers = rosters
				.filter(r => r.owner_id)
				.map(r => {
					const u = userMap.get(r.owner_id);
					const fpts = (r.settings.fpts ?? 0) + (r.settings.fpts_decimal ?? 0) / 100;
					const fptsA = (r.settings.fpts_against ?? 0) + (r.settings.fpts_against_decimal ?? 0) / 100;
					return {
						userId: r.owner_id,
						displayName: u?.display_name ?? `Team ${r.roster_id}`,
						teamName: u?.metadata?.team_name ?? u?.display_name ?? `Team ${r.roster_id}`,
						avatar: u?.avatar ? `https://sleepercdn.com/avatars/thumbs/${u.avatar}` : null,
						rosterId: r.roster_id,
						wins: r.settings.wins ?? 0,
						losses: r.settings.losses ?? 0,
						ties: r.settings.ties ?? 0,
						fpts,
						fptsAgainst: fptsA,
					};
				})
				.sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	});
</script>

<div>
	<h1 class="text-2xl font-bold mb-6">Managers</h1>

	{#if loading}
		<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each Array(6) as _}
				<div class="h-28 bg-gray-800 rounded-xl animate-pulse"></div>
			{/each}
		</div>
	{:else if error}
		<p class="text-red-400">Failed to load managers: {error}</p>
	{:else if managers.length === 0}
		<p class="text-gray-400">No managers found.</p>
	{:else}
		<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each managers as mgr}
				<a
					href="/league/{data.leagueId}/managers/{mgr.userId}"
					class="bg-gray-900 rounded-xl border border-gray-800 hover:border-gray-700 transition-colors p-4 flex gap-4 items-center"
				>
					{#if mgr.avatar}
						<img src={mgr.avatar} alt="" class="w-12 h-12 rounded-full object-cover shrink-0" />
					{:else}
						<div class="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center text-xl shrink-0">🏈</div>
					{/if}
					<div class="min-w-0">
						<p class="font-semibold text-white truncate">{mgr.teamName}</p>
						<p class="text-xs text-gray-500 truncate">{mgr.displayName}</p>
						<div class="flex items-center gap-3 mt-1">
							<span class="text-xs text-gray-400">
								{mgr.wins}–{mgr.losses}{mgr.ties ? `–${mgr.ties}` : ''}
							</span>
							<span class="text-xs text-gray-600">{mgr.fpts.toFixed(2)} pts</span>
						</div>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
