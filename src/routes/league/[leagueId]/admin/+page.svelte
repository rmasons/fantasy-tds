<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import type { SeedDraftResult } from '$lib/server/drafts';

	let { data, form } = $props<{ data: PageData; form: ActionData }>();

	// ── Draft cache ──────────────────────────────────────────────────────────────
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

	// ── FAAB bonuses ─────────────────────────────────────────────────────────────
	let faabBonuses = $state<Record<string, number>>({ ...(data.faabBonuses ?? {}) });

	function faabBonusFor(rosterId: string): number {
		return faabBonuses[rosterId] ?? 0;
	}

	function setFaabBonus(rosterId: string, raw: string) {
		const val = parseInt(raw, 10);
		const copy = { ...faabBonuses };
		if (raw === '' || val <= 0 || isNaN(val)) delete copy[rosterId];
		else copy[rosterId] = val;
		faabBonuses = copy;
	}

	// ── Navigation config ────────────────────────────────────────────────────────
	const ALL_NAV = [
		{ href: 'standings',       label: 'Standings'       },
		{ href: 'matchups',        label: 'Matchups'        },
		{ href: 'power-rankings',  label: 'Power Rankings'  },
		{ href: 'rosters',         label: 'Rosters'         },
		{ href: 'history',         label: 'Awards & Records' },
		{ href: 'transactions',    label: 'Transactions'    },
		{ href: 'drafts',          label: 'Drafts'          },
		{ href: 'managers',        label: 'Managers'        },
		{ href: 'rivalry',         label: 'Rivalry'         },
		{ href: 'keepers',         label: 'Keepers'         },
		{ href: 'superlatives',    label: 'Superlatives'    },
		{ href: 'blog',            label: 'Blog'            },
	];

	interface NavItem { href: string; label: string; enabled: boolean; }

	function initNavItems(saved: string[]): NavItem[] {
		// Empty/null saved means "all defaults" — show everything as enabled
		if (!saved || saved.length === 0) return ALL_NAV.map(n => ({ ...n, enabled: true }));
		const enabledSet = new Set(saved);
		const ordered = saved
			.map(h => ALL_NAV.find(n => n.href === h))
			.filter((n): n is typeof ALL_NAV[0] => !!n)
			.map(n => ({ ...n, enabled: true }));
		const rest = ALL_NAV
			.filter(n => !enabledSet.has(n.href))
			.map(n => ({ ...n, enabled: false }));
		return [...ordered, ...rest];
	}

	let navItems = $state<NavItem[]>(initNavItems(data.leagueConfig.enabledNavItems ?? []));

	function moveUp(i: number) {
		if (i === 0) return;
		const arr = [...navItems];
		[arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
		navItems = arr;
	}

	function moveDown(i: number) {
		if (i === navItems.length - 1) return;
		const arr = [...navItems];
		[arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
		navItems = arr;
	}

	const enabledNavValue = $derived(
		navItems.filter(n => n.enabled).map(n => n.href).join(',')
	);

	// ── Danger zone ───────────────────────────────────────────────────────────────
	let confirmDelete = $state(false);
</script>

<div class="max-w-2xl">
	<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none mb-1">League Admin</h1>
	<p class="text-navy-500 text-[10px] uppercase tracking-[0.2em] font-semibold mb-8">Tools for commissioners. Changes affect all league members.</p>

	<!-- ── Draft Cache ── -->
	<section class="bg-navy-850 rounded-lg border border-navy-700 p-6 mb-6">
		<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-1 flex items-center gap-2"><span class="text-amber-400">◆</span>Draft Cache</h2>
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
				<p class="text-xs text-navy-500 mb-3">
					{newCount} newly cached · {cachedCount} already cached
					{#if errorCount > 0}· <span class="text-red-400">{errorCount} error(s)</span>{/if}
				</p>
				<div class="rounded-lg border border-navy-700 overflow-hidden">
					<table class="w-full text-sm">
						<thead>
							<tr class="bg-navy-900 text-left">
								<th class="px-4 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider">Season</th>
								<th class="px-4 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider">Type</th>
								<th class="px-4 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider text-right">Picks</th>
								<th class="px-4 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider">Status</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-navy-700/60">
							{#each seedResults as r}
								<tr class="hover:bg-navy-800">
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

	<!-- ── FAAB Bonuses ── -->
	<section class="bg-navy-850 rounded-lg border border-navy-700 p-6 mb-6">
		<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-1 flex items-center gap-2"><span class="text-amber-400">◆</span>FAAB Bonuses</h2>
		<p class="text-sm text-slate-400 mb-4">
			Award extra FAAB outside Sleeper. Bonuses are added to each team's Sleeper balance on the Keepers page.
		</p>

		<form method="POST" action="?/saveFaabBonuses" use:enhance class="space-y-3">
			{#each data.rosterList as roster}
				<div class="flex items-center gap-3">
					<span class="flex-1 text-sm text-slate-300 truncate">{roster.teamName}</span>
					<div class="flex items-center gap-1.5">
						<span class="text-navy-500 text-sm">$</span>
						<input
							type="number"
							name="faab_{roster.rosterId}"
							min="0"
							step="1"
							value={faabBonusFor(roster.rosterId) || ''}
							oninput={(e) => setFaabBonus(roster.rosterId, (e.target as HTMLInputElement).value)}
							placeholder="0"
							class="w-20 bg-navy-800 border border-navy-700 rounded-lg px-2 py-1.5 text-sm text-white
							       placeholder-navy-500 focus:outline-none focus:border-amber-500 text-right transition-colors"
						/>
					</div>
				</div>
			{/each}

			{#if data.rosterList.length === 0}
				<p class="text-sm text-navy-500">No rosters found.</p>
			{/if}

			<div class="flex items-center gap-4 pt-2">
				<button
					type="submit"
					class="px-4 py-2 text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-lg transition-colors"
				>
					Save Bonuses
				</button>
				{#if form?.faabSuccess}
					<span class="text-xs text-green-400">Saved.</span>
				{/if}
			</div>
		</form>
	</section>

	<!-- ── Blog (Contentful) + Navigation ── -->
	<section class="bg-navy-850 rounded-lg border border-navy-700 p-6 mb-6">
		<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-4 flex items-center gap-2"><span class="text-amber-400">◆</span>League Config</h2>

		<form method="POST" action="?/saveConfig" use:enhance class="space-y-6">
			<!-- Contentful / Blog -->
			<div class="space-y-3">
				<p class="text-xs font-semibold text-navy-500 uppercase tracking-wider">Blog (Contentful)</p>

				<div>
					<label for="contentfulSpaceId" class="block text-xs text-slate-400 mb-1">Space ID</label>
					<input
						id="contentfulSpaceId"
						name="contentfulSpaceId"
						type="text"
						value={data.leagueConfig.contentfulSpaceId ?? ''}
						placeholder="xxxxxxxxxxxxxxxxx"
						class="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-2 text-sm text-white
						       placeholder-navy-500 focus:outline-none focus:border-amber-500 font-mono transition-colors"
					/>
				</div>

				<div>
					<label for="contentfulAccessToken" class="block text-xs text-slate-400 mb-1">
						Content Delivery Token
						{#if data.leagueConfig.hasAccessToken}
							<span class="text-green-500 font-normal ml-1">set</span>
						{/if}
					</label>
					<input
						id="contentfulAccessToken"
						name="contentfulAccessToken"
						type="password"
						placeholder={data.leagueConfig.hasAccessToken ? 'leave blank to keep existing' : 'Content Delivery API access token'}
						class="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-2 text-sm text-white
						       placeholder-navy-500 focus:outline-none focus:border-amber-500 font-mono transition-colors"
					/>
				</div>

				<div>
					<label for="contentfulManagementToken" class="block text-xs text-slate-400 mb-1">
						Management Token
						<span class="text-navy-500 font-normal">(optional — for comments)</span>
						{#if data.leagueConfig.hasManagementToken}
							<span class="text-green-500 font-normal ml-1">set</span>
						{/if}
					</label>
					<input
						id="contentfulManagementToken"
						name="contentfulManagementToken"
						type="password"
						placeholder={data.leagueConfig.hasManagementToken ? 'leave blank to keep existing' : 'Content Management API token'}
						class="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-2 text-sm text-white
						       placeholder-navy-500 focus:outline-none focus:border-amber-500 font-mono transition-colors"
					/>
				</div>
			</div>

			<hr class="border-navy-700" />

			<!-- Navigation -->
			<div class="space-y-3">
				<div>
					<p class="text-xs font-semibold text-navy-500 uppercase tracking-wider">Navigation</p>
					<p class="text-xs text-slate-500 mt-0.5">Toggle items on/off and reorder. Leave all enabled to show defaults.</p>
				</div>

				<input type="hidden" name="enabledNavItems" value={enabledNavValue} />

				<div class="space-y-1">
					{#each navItems as item, i}
						<div class="flex items-center gap-3 rounded-lg px-3 py-2
						            {item.enabled ? 'bg-navy-800' : 'bg-navy-900/50'}
						            transition-colors">
							<input
								type="checkbox"
								id="nav-{item.href}"
								bind:checked={navItems[i].enabled}
								class="w-4 h-4 rounded cursor-pointer accent-amber-500"
							/>
							<label for="nav-{item.href}" class="flex-1 text-sm cursor-pointer
							       {item.enabled ? 'text-white' : 'text-navy-500'}">
								{item.label}
							</label>
							<div class="flex gap-0.5">
								<button
									type="button"
									onclick={() => moveUp(i)}
									disabled={i === 0}
									class="p-1 rounded text-navy-500 hover:text-slate-300 disabled:opacity-20 transition-colors"
									title="Move up"
								>▲</button>
								<button
									type="button"
									onclick={() => moveDown(i)}
									disabled={i === navItems.length - 1}
									class="p-1 rounded text-navy-500 hover:text-slate-300 disabled:opacity-20 transition-colors"
									title="Move down"
								>▼</button>
							</div>
						</div>
					{/each}
				</div>
			</div>

			<div class="flex items-center gap-4">
				<button
					type="submit"
					class="px-4 py-2 text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-lg transition-colors"
				>
					Save Config
				</button>
				{#if form?.configSuccess}
					<span class="text-xs text-green-400">Saved.</span>
				{/if}
			</div>
		</form>
	</section>

	<!-- ── Danger Zone ── -->
	<section class="rounded-lg border border-red-900/40 p-6 mb-6">
		<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-red-400 mb-1 flex items-center gap-2"><span>◆</span>Danger Zone</h2>
		<p class="text-sm text-slate-500 mb-4">
			Deletes this league's config from Firestore — blog tokens, nav order, and FAAB bonuses will be lost. The Sleeper league itself is unaffected.
		</p>

		{#if confirmDelete}
			<form method="POST" action="?/deleteConfig" use:enhance class="flex items-center gap-3">
				<span class="text-xs text-red-400">Are you sure?</span>
				<button
					type="submit"
					class="px-4 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-xs font-medium text-white transition-colors"
				>
					Yes, delete
				</button>
				<button
					type="button"
					onclick={() => (confirmDelete = false)}
					class="px-4 py-1.5 rounded-lg bg-navy-800 hover:bg-navy-700 text-xs text-slate-300 transition-colors"
				>
					Cancel
				</button>
			</form>
		{:else}
			<button
				onclick={() => (confirmDelete = true)}
				class="px-4 py-1.5 rounded-lg border border-red-900 hover:bg-red-950/50 text-xs text-red-400 transition-colors"
			>
				Delete league config
			</button>
		{/if}
	</section>
</div>
