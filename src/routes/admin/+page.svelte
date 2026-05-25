<script lang="ts">
	import { goto } from '$app/navigation';
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let newLeagueId = $state('');

	function configureLeague() {
		const id = newLeagueId.trim();
		if (id) goto(`/admin/leagues/${id}`);
	}

	const leagueIds = $derived(Object.keys(data.leagueConfigs).sort());

	// FAAB bonuses
	let selectedLeagueId = $state(leagueIds[0] ?? '');
	let faabBonuses = $state<Record<string, Record<string, number>>>(
		Object.fromEntries(
			leagueIds.map(id => [id, { ...(data.leagueConfigs[id].faabBonuses ?? {}) }])
		)
	);

	function faabBonusFor(leagueId: string, rosterId: string): number {
		return faabBonuses[leagueId]?.[rosterId] ?? 0;
	}

	function setFaabBonus(leagueId: string, rosterId: string, raw: string) {
		const val = parseInt(raw, 10);
		const league = { ...(faabBonuses[leagueId] ?? {}) };
		if (raw === '' || val <= 0 || isNaN(val)) {
			delete league[rosterId];
		} else {
			league[rosterId] = val;
		}
		faabBonuses = { ...faabBonuses, [leagueId]: league };
	}
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
					{#if data.appConfig.defaultLeagueId}
						{data.appConfig.defaultLeagueId}
					{:else}
						<span class="italic">not set</span>
					{/if}
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

	<!-- FAAB Bonuses -->
	{#if leagueIds.length > 0}
	<section>
		<h2 class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">FAAB Bonuses</h2>
		<div class="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
			<p class="text-xs text-slate-500">Award extra FAAB outside Sleeper. Added to each team's balance on the Keepers page.</p>

			{#if leagueIds.length > 1}
				<div class="flex gap-2">
					{#each leagueIds as id}
						<button
							type="button"
							onclick={() => (selectedLeagueId = id)}
							class="px-3 py-1 rounded-lg text-xs font-medium transition-colors
							       {selectedLeagueId === id ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}"
						>{id}</button>
					{/each}
				</div>
			{/if}

			<form method="POST" action="?/saveFaabBonuses" use:enhance class="space-y-3">
				<input type="hidden" name="leagueId" value={selectedLeagueId} />

				{#each (data.rostersByLeague[selectedLeagueId] ?? []) as roster}
					<div class="flex items-center gap-3">
						<span class="flex-1 text-sm text-slate-300 truncate">{roster.teamName}</span>
						<div class="flex items-center gap-1">
							<span class="text-slate-600 text-sm">$</span>
							<input
								type="number"
								name="faab_{roster.rosterId}"
								min="0"
								step="1"
								value={faabBonusFor(selectedLeagueId, roster.rosterId) || ''}
								oninput={(e) => setFaabBonus(selectedLeagueId, roster.rosterId, (e.target as HTMLInputElement).value)}
								placeholder="0"
								class="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white
								       placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 text-right"
							/>
						</div>
					</div>
				{/each}

				{#if (data.rostersByLeague[selectedLeagueId] ?? []).length === 0}
					<p class="text-xs text-slate-600">No rosters loaded for this league.</p>
				{/if}

				<div class="flex items-center gap-4 pt-1">
					<button
						type="submit"
						class="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors"
					>
						Save Bonuses
					</button>
					{#if form?.faabSuccess && form?.savedLeagueId === selectedLeagueId}
						<span class="text-xs text-emerald-400">Saved.</span>
					{/if}
				</div>
			</form>
		</div>
	</section>
	{/if}

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
