<script lang="ts">
	import type { PageData } from './$types';
	import type { SeedDraftResult } from '$lib/server/drafts';

	let { data } = $props<{ data: PageData }>();

	let seeding = $state(false);
	let seedResults = $state<SeedDraftResult[]>([]);
	let seedError = $state('');
	let done = $state(false);

	async function seedDrafts() {
		seeding = true;
		seedResults = [];
		seedError = '';
		done = false;
		try {
			const res = await fetch(
				`/api/drafts?leagueId=${encodeURIComponent(data.leagueId)}`,
				{ method: 'POST' },
			);
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.message ?? `HTTP ${res.status}`);
			}
			const { results } = await res.json();
			seedResults = results;
			done = true;
		} catch (e: any) {
			seedError = e.message;
		} finally {
			seeding = false;
		}
	}

	const statusLabel: Record<SeedDraftResult['status'], string> = {
		seeded:         'Seeded',
		already_cached: 'Already cached',
		empty:          'No picks',
		error:          'Error',
	};

	const statusClass: Record<SeedDraftResult['status'], string> = {
		seeded:         'text-green-400',
		already_cached: 'text-slate-500',
		empty:          'text-amber-500',
		error:          'text-red-400',
	};

	const newCount    = $derived(seedResults.filter(r => r.status === 'seeded').length);
	const cachedCount = $derived(seedResults.filter(r => r.status === 'already_cached').length);
	const errorCount  = $derived(seedResults.filter(r => r.status === 'error').length);
</script>

<div class="max-w-2xl">
	<h1 class="text-2xl font-extrabold text-white mb-1">League Admin</h1>
	<p class="text-sm text-slate-500 mb-8">Tools for commissioners. Changes affect all league members.</p>

	<!-- ── Draft Cache ── -->
	<section class="bg-slate-900 rounded-xl border border-slate-800 p-6 mb-6">
		<h2 class="text-base font-bold text-white mb-1">Draft Cache</h2>
		<p class="text-sm text-slate-400 mb-4">
			Pre-populate the draft pick cache so the Drafts page loads instantly
			without hitting the Sleeper API. Walks the full season history.
			Already-cached drafts are skipped — safe to re-run.
		</p>

		<button
			onclick={seedDrafts}
			disabled={seeding}
			class="px-4 py-2 text-sm font-bold bg-amber-500 hover:bg-amber-400 disabled:opacity-40
			       text-slate-900 rounded-lg transition-colors"
		>
			{seeding ? 'Seeding…' : 'Seed Draft History'}
		</button>

		{#if seedError}
			<p class="mt-3 text-sm text-red-400">{seedError}</p>
		{/if}

		{#if seeding}
			<p class="mt-3 text-sm text-slate-500 animate-pulse">
				Fetching from Sleeper and writing to Firestore…
			</p>
		{/if}

		{#if done && seedResults.length > 0}
			<div class="mt-4">
				<p class="text-xs text-slate-500 mb-3">
					{newCount} newly cached · {cachedCount} already cached
					{#if errorCount > 0}· <span class="text-red-400">{errorCount} error(s)</span>{/if}
				</p>
				<div class="rounded-lg border border-slate-800 overflow-hidden">
					<table class="w-full text-sm">
						<thead>
							<tr class="bg-slate-800/60 text-left">
								<th class="px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Season</th>
								<th class="px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Type</th>
								<th class="px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide text-right">Picks</th>
								<th class="px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-800/60">
							{#each seedResults as r}
								<tr class="hover:bg-slate-800/30">
									<td class="px-4 py-2.5 text-slate-300 font-medium">{r.season}</td>
									<td class="px-4 py-2.5 text-slate-400 capitalize">{r.type}</td>
									<td class="px-4 py-2.5 text-slate-400 text-right font-mono">{r.picks > 0 ? r.picks : '—'}</td>
									<td class="px-4 py-2.5 {statusClass[r.status]}">
										{statusLabel[r.status]}
										{#if r.error}
											<span class="text-xs text-red-500 ml-1">({r.error})</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{:else if done}
			<p class="mt-3 text-sm text-slate-500">No completed drafts found in this league's history.</p>
		{/if}
	</section>
</div>
