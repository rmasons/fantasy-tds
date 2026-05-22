<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let newLeagueId = $state('');

	function configureLeague() {
		const id = newLeagueId.trim();
		if (id) goto(`/admin/leagues/${id}`);
	}

	const leagueIds = $derived(Object.keys(data.leagueConfigs).sort());
</script>

<div class="space-y-10">
	<div>
		<h1 class="text-2xl font-extrabold text-white">Dashboard</h1>
		<p class="text-slate-500 text-sm mt-1">Manage app and league configuration.</p>
	</div>

	<!-- App Config card -->
	<section>
		<h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">App Config</h2>
		<div class="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center justify-between gap-4">
			<div>
				<p class="text-sm font-medium text-white">Default League</p>
				<p class="text-xs text-slate-500 mt-0.5">
					{data.appConfig.defaultLeagueId ?? <span class="italic">not set</span>}
				</p>
			</div>
			<a
				href="/admin/app"
				class="shrink-0 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm text-slate-300 hover:text-white transition-colors"
			>
				Edit
			</a>
		</div>
	</section>

	<!-- Leagues -->
	<section>
		<h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
			Configured Leagues ({leagueIds.length})
		</h2>

		{#if leagueIds.length === 0}
			<p class="text-slate-600 text-sm">No leagues configured yet.</p>
		{:else}
			<div class="space-y-2">
				{#each leagueIds as id}
					<div class="bg-slate-900 border border-slate-800 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
						<div>
							<p class="font-mono text-sm text-white">{id}</p>
							<p class="text-xs text-slate-500 mt-0.5">
								{#if data.leagueConfigs[id].enabledNavItems?.length}
									Nav: {data.leagueConfigs[id].enabledNavItems!.join(', ')}
								{:else}
									Nav: default (all items)
								{/if}
								{#if data.leagueConfigs[id].contentfulSpaceId}
									· Blog: configured
								{/if}
							</p>
						</div>
						<a
							href="/admin/leagues/{id}"
							class="shrink-0 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm text-slate-300 hover:text-white transition-colors"
						>
							Edit
						</a>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Add / configure a league -->
	<section>
		<h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Configure a League</h2>
		<div class="bg-slate-900 border border-slate-800 rounded-xl p-5">
			<p class="text-xs text-slate-500 mb-3">Enter a Sleeper league ID to open its config.</p>
			<div class="flex gap-3">
				<input
					type="text"
					bind:value={newLeagueId}
					placeholder="Sleeper league ID"
					onkeydown={(e) => e.key === 'Enter' && configureLeague()}
					class="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
				/>
				<button
					onclick={configureLeague}
					disabled={!newLeagueId.trim()}
					class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-medium text-white transition-colors"
				>
					Configure →
				</button>
			</div>
		</div>
	</section>
</div>
