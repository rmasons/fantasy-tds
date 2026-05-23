<script lang="ts">
	import type { PageData } from './$types';
	import { fetchRosters, fetchUsers, buildRosterInfoMap, combineFpts } from '$lib/sleeper';
	import type { ManagerProfile } from '$lib/types';

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
	let profiles = $state<Record<string, ManagerProfile>>({});
	let loading = $state(true);
	let error = $state('');

	$effect(() => {
		const leagueId = data.leagueId;
		managers = [];
		profiles = {};
		loading = true;
		error = '';

		(async () => {
			try {
				const [rosters, users] = await Promise.all([
					fetchRosters(leagueId),
					fetchUsers(leagueId),
				]);

				if (data.leagueId !== leagueId) return;

				const rosterInfo = buildRosterInfoMap(rosters, users);

				const built = rosters
					.filter(r => r.owner_id)
					.map(r => {
						const info = rosterInfo.get(r.roster_id)!;
						return {
							userId: r.owner_id,
							displayName: info.ownerName ?? info.teamName,
							teamName: info.teamName,
							avatar: info.avatar,
							rosterId: r.roster_id,
							wins: r.settings.wins ?? 0,
							losses: r.settings.losses ?? 0,
							ties: r.settings.ties ?? 0,
							fpts: combineFpts(r.settings.fpts, r.settings.fpts_decimal),
							fptsAgainst: combineFpts(r.settings.fpts_against, r.settings.fpts_against_decimal),
						};
					})
					.sort((a, b) => b.wins - a.wins || b.fpts - a.fpts);

				managers = built;

				// Fetch profiles in background — don't block card render
				const ids = built.map(m => m.userId).join(',');
				fetch(`/api/profiles?ids=${ids}`)
					.then(r => r.json())
					.then(p => {
						if (data.leagueId !== leagueId) return;
						profiles = p;
					})
					.catch(() => {});
			} catch (e: any) {
				if (data.leagueId !== leagueId) return;
				error = e.message;
			} finally {
				if (data.leagueId !== leagueId) return;
				loading = false;
			}
		})();
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
				{@const realName = profile?.displayName || [profile?.firstName, profile?.lastName].filter(Boolean).join(' ')}
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
						<p class="font-semibold text-white truncate">{mgr.teamName}</p>
						<p class="text-xs text-navy-500 truncate">{realName || mgr.displayName}</p>
						<div class="flex items-center gap-3 mt-1">
							<span class="text-xs text-slate-400 tabular-nums">
								{mgr.wins}–{mgr.losses}{mgr.ties ? `–${mgr.ties}` : ''}
							</span>
							<span class="text-xs text-navy-500 tabular-nums">{mgr.fpts.toFixed(2)} pts</span>
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
	{/if}
</div>
