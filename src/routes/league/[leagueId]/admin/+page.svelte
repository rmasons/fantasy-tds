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

	// ── Superlatives ─────────────────────────────────────────────────────────────
	let supRunning = $state(false);
	let supResult = $state<Array<{ season: string; computed: number }>>([]);
	let supError = $state('');
	let supDone = $state(false);

	let supDeleteSeason = $state('');
	let supDeleting = $state(false);
	let supDeleteError = $state('');
	let supDeleteDone = $state(false);

	async function deleteSuperlativeSeason() {
		const season = supDeleteSeason.trim();
		if (!/^\d{4}$/.test(season)) return;
		supDeleting = true;
		supDeleteError = '';
		supDeleteDone = false;
		try {
			const res = await fetch(`/api/superlatives/${encodeURIComponent(data.leagueId)}`, {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ season }),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.message ?? `HTTP ${res.status}`);
			}
			supDeleteDone = true;
			supDeleteSeason = '';
		} catch (e: any) {
			supDeleteError = e.message;
		} finally {
			supDeleting = false;
		}
	}

	async function runSuperlatives() {
		supRunning = true;
		supResult = [];
		supError = '';
		supDone = false;
		try {
			const res = await fetch(`/api/superlatives/${encodeURIComponent(data.leagueId)}`, { method: 'PUT' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body.message ?? `HTTP ${res.status}`);
			}
			const { seasons } = await res.json();
			supResult = seasons ?? [];
			supDone = true;
		} catch (e: any) {
			supError = e.message;
		} finally {
			supRunning = false;
		}
	}

	// ── FAAB ledger ──────────────────────────────────────────────────────────────
	const teamNameFor = (rosterId: string) =>
		data.rosterList.find((r: { rosterId: string; teamName: string }) => r.rosterId === rosterId)?.teamName
		?? `Roster ${rosterId}`;

	const fmtFaab = (amount: number) => (amount >= 0 ? '+$' : '-$') + Math.abs(amount);

	const fmtFaabDate = (ts: number) =>
		ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

	// ── Premier Keepers ──────────────────────────────────────────────────────────
	let rulesetIsPremier = $state(data.leagueConfig.ruleset === 'premier');

	let seedingTiers = $state(false);

	// Local editable copy of this season's tier assignments — seeded from
	// data.leagueConfig.premier.tiersForSeason and re-synced whenever a save/seed
	// action returns fresh data.
	let tierSeason = $state(data.season || String(new Date().getFullYear()));
	let tierByRoster = $state<Record<string, '1' | '2' | '3' | ''>>(
		Object.fromEntries(
			data.rosterList.map((r: { rosterId: string }) => [
				r.rosterId,
				String(data.leagueConfig.premier.tiersForSeason[r.rosterId] ?? ''),
			]),
		),
	);

	const promotionKindLabel: Record<string, string> = {
		collusion: 'Collusion (fixed −5)',
		neglect: 'Roster neglect (escalating)',
		other: 'Other (manual amount)',
	};

	let promotionKind = $state<'collusion' | 'neglect' | 'other'>('collusion');
	const fmtPP = (amount: number) => (amount >= 0 ? '+' : '−') + Math.abs(amount) + ' PP';

	// ── Keeper selections ─────────────────────────────────────────────────────────
	const posColor = (pos: string) =>
		({
			QB: 'text-red-400',
			RB: 'text-green-400',
			WR: 'text-blue-400',
			TE: 'text-amber-400',
			K: 'text-purple-400',
			DEF: 'text-slate-400',
		})[pos] ?? 'text-navy-400';

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
		{ href: 'tiers',           label: 'Tiers'           },
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

	<!-- ── Superlatives ── -->
	<section class="bg-navy-850 rounded-lg border border-navy-700 p-6 mb-6">
		<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-1 flex items-center gap-2"><span class="text-amber-400">◆</span>Superlatives</h2>
		<p class="text-sm text-slate-400 mb-4">
			Compute this season's superlatives from matchup history and save to Firestore.
			The Superlatives page reads exclusively from this cache — run this to update it.
		</p>

		<button
			onclick={runSuperlatives}
			disabled={supRunning}
			class="px-4 py-2 text-sm font-bold bg-amber-500 hover:bg-amber-400 disabled:opacity-40
			       text-slate-900 rounded-lg transition-colors"
		>
			{supRunning ? 'Computing…' : 'Run Superlatives'}
		</button>

		{#if supError}
			<p class="mt-3 text-sm text-red-400">{supError}</p>
		{/if}

		{#if supRunning}
			<p class="mt-3 text-sm text-slate-500 animate-pulse">Fetching matchups and writing to Firestore…</p>
		{/if}

		{#if supDone}
			{#if supResult.length > 0}
				<div class="mt-4 rounded-lg border border-navy-700 overflow-hidden">
					<table class="w-full text-sm">
						<thead>
							<tr class="bg-navy-900 text-left">
								<th class="px-4 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider">Season</th>
								<th class="px-4 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider text-right">Computed</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-navy-700/60">
							{#each supResult as r}
								<tr class="hover:bg-navy-800">
									<td class="px-4 py-2.5 text-slate-300 font-medium">{r.season}</td>
									<td class="px-4 py-2.5 text-slate-400 text-right font-mono">{r.computed}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="mt-3 text-sm text-slate-500">No seasons computed.</p>
			{/if}
		{/if}

		<div class="mt-6 pt-5 border-t border-navy-700">
			<p class="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-3">Delete a Season</p>
			<div class="flex items-center gap-3">
				<input
					type="text"
					bind:value={supDeleteSeason}
					placeholder="YYYY"
					maxlength="4"
					class="w-24 bg-navy-800 border border-navy-700 rounded-lg px-3 py-2 text-sm text-white
					       placeholder-navy-500 focus:outline-none focus:border-red-700 font-mono transition-colors"
				/>
				<button
					onclick={deleteSuperlativeSeason}
					disabled={supDeleting || !/^\d{4}$/.test(supDeleteSeason.trim())}
					class="px-4 py-2 text-sm font-bold bg-red-800 hover:bg-red-700 disabled:opacity-40
					       text-white rounded-lg transition-colors"
				>
					{supDeleting ? 'Deleting…' : 'Delete'}
				</button>
				{#if supDeleteDone}
					<span class="text-xs text-green-400">Deleted.</span>
				{/if}
				{#if supDeleteError}
					<span class="text-xs text-red-400">{supDeleteError}</span>
				{/if}
			</div>
		</div>
	</section>

	<!-- ── Premier Keepers Ruleset ── -->
	<section class="bg-navy-850 rounded-lg border border-navy-700 p-6 mb-6">
		<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-1 flex items-center gap-2"><span class="text-amber-400">◆</span>Premier Keepers Ruleset</h2>
		<p class="text-sm text-slate-400 mb-4">
			Switches this league between the classic ruleset and Premier Keepers (tiers,
			promotion points, per-tier budgets). Leave off for a normal fantasy-tds league.
		</p>

		<form method="POST" action="?/savePremierConfig" use:enhance class="space-y-5">
			<label class="flex items-center gap-3">
				<input
					type="checkbox"
					bind:checked={rulesetIsPremier}
					class="w-4 h-4 rounded cursor-pointer accent-amber-500"
				/>
				<input type="hidden" name="ruleset" value={rulesetIsPremier ? 'premier' : 'classic'} />
				<span class="text-sm text-white font-semibold">Enable Premier Keepers ruleset</span>
			</label>

			{#if rulesetIsPremier}
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
					{#each [['auctionBudget', 'Auction Budget', data.leagueConfig.premier.auctionBudget], ['faabBudget', 'FAAB Budget', data.leagueConfig.premier.faabBudget], ['tradeBudgetCap', 'Trade Budget Cap', data.leagueConfig.premier.tradeBudgetCap]] as [name, label, defaults]}
						<div>
							<p class="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-2">{label}</p>
							<div class="space-y-1.5">
								{#each [1, 2, 3] as tier}
									<div class="flex items-center gap-2">
										<span class="text-[10px] text-navy-500 w-14 shrink-0">Tier {tier}</span>
										<input
											type="number"
											name="{name}{tier}"
											value={(defaults as Record<number, number>)[tier]}
											min="0"
											class="w-full bg-navy-800 border border-navy-700 rounded-lg px-2.5 py-1.5 text-sm text-white
											       focus:outline-none focus:border-amber-500 font-mono transition-colors"
										/>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				</div>

				<div>
					<label for="regularSeasonEndWeek" class="block text-xs font-semibold text-navy-500 uppercase tracking-wider mb-1">
						Regular Season / PP Cutoff Week
					</label>
					<input
						id="regularSeasonEndWeek"
						type="number"
						name="regularSeasonEndWeek"
						value={data.leagueConfig.premier.regularSeasonEndWeek}
						min="1"
						max="18"
						class="w-24 bg-navy-800 border border-navy-700 rounded-lg px-3 py-1.5 text-sm text-white
						       focus:outline-none focus:border-amber-500 font-mono transition-colors"
					/>
				</div>
			{/if}

			<button
				type="submit"
				class="px-4 py-2 text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-lg transition-colors"
			>
				Save Ruleset
			</button>
			{#if form?.premierSuccess}
				<span class="text-xs text-green-400 ml-3">Saved.</span>
			{/if}
		</form>
	</section>

	{#if rulesetIsPremier}
		<!-- ── Tier Assignments ── -->
		<section class="bg-navy-850 rounded-lg border border-navy-700 p-6 mb-6">
			<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-1 flex items-center gap-2"><span class="text-amber-400">◆</span>Tier Assignments</h2>
			<p class="text-sm text-slate-400 mb-4">
				Per-season tier snapshot (Tier I / II / III), keyed by season since Sleeper's own
				division field mutates on promotion. Seed the current live season straight from
				Sleeper's roster divisions, or hand-enter a season (e.g. 2024, 2023) below.
			</p>

			{#if data.seasonUnavailable}
				<div class="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 mb-4">
					<p class="text-amber-300 text-sm font-medium">Couldn't reach Sleeper to determine this league's season.</p>
					<p class="text-amber-300/70 text-sm mt-1">
						Existing tier assignments and Promotion Points entries are <strong>not</strong> shown below and have
						<strong>not</strong> been lost. Reload before making changes.
					</p>
				</div>
			{/if}

			<form method="POST" action="?/seedTiers" use:enhance={() => { seedingTiers = true; return async ({ update }) => { await update(); seedingTiers = false; }; }} class="mb-5">
				<button
					type="submit"
					disabled={seedingTiers}
					class="px-4 py-2 text-sm font-bold bg-navy-700 hover:bg-navy-600 disabled:opacity-40 text-white rounded-lg transition-colors"
				>
					{seedingTiers ? 'Seeding…' : `Seed ${data.season || 'current season'} from Sleeper`}
				</button>
				<span class="text-xs text-navy-500 ml-2">Only seeds THIS league's own season — never a prior year.</span>
			</form>

			{#if form?.tiersError}
				<p class="text-sm text-red-400 mb-3">{form.tiersError}</p>
			{/if}
			{#if form?.tiersSuccess}
				<p class="text-sm text-green-400 mb-3">Saved {form.seededCount} roster{form.seededCount === 1 ? '' : 's'} for {form.seededSeason}.</p>
				{#if form.unassignedRosters?.length}
					<p class="text-sm text-amber-400 mb-3">
						{form.unassignedRosters.length} roster{form.unassignedRosters.length === 1 ? ' was' : 's were'} left unassigned and will score no Promotion Points.
					</p>
				{/if}
			{/if}

			<form method="POST" action="?/saveTiers" use:enhance class="space-y-3">
				<label class="flex items-center gap-2">
					<span class="text-[10px] uppercase tracking-widest text-navy-500 font-semibold">Season</span>
					<input
						type="text"
						name="season"
						bind:value={tierSeason}
						maxlength="4"
						placeholder="YYYY"
						class="w-24 bg-navy-800 border border-navy-700 rounded-lg px-3 py-1.5 text-sm text-white
						       placeholder-navy-500 focus:outline-none focus:border-amber-500 font-mono transition-colors"
					/>
				</label>

				<div class="rounded-lg border border-navy-700 overflow-hidden">
					<table class="w-full text-sm">
						<thead>
							<tr class="bg-navy-900 text-left">
								<th class="px-3 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider">Manager</th>
								<th class="px-3 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider">Tier</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-navy-700/60">
							{#each data.rosterList as roster}
								<tr class="hover:bg-navy-800">
									<td class="px-3 py-2.5 text-slate-300 font-medium">{roster.teamName}</td>
									<td class="px-3 py-2.5">
										<select
											name="tier_{roster.rosterId}"
											bind:value={tierByRoster[roster.rosterId]}
											class="bg-navy-800 border border-navy-700 rounded-lg px-2.5 py-1 text-sm text-white focus:outline-none focus:border-amber-500"
										>
											<option value="">—</option>
											<option value="1">Tier I</option>
											<option value="2">Tier II</option>
											<option value="3">Tier III</option>
										</select>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<button
					type="submit"
					class="px-4 py-2 text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-lg transition-colors"
				>
					Save Tiers
				</button>
			</form>
		</section>

		<!-- ── Promotion Points Ledger ── -->
		<section class="bg-navy-850 rounded-lg border border-navy-700 p-6 mb-6">
			<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-1 flex items-center gap-2"><span class="text-amber-400">◆</span>Promotion Points Ledger</h2>
			<p class="text-sm text-slate-400 mb-4">
				Manual PP adjustments — collusion and roster neglect (§III). Neglect's penalty
				escalates automatically: the app counts this roster's prior neglect entries for the
				season and picks −1 / −3 / −5 / −10 for you.
			</p>

			<form method="POST" action="?/addPromotion" use:enhance class="flex flex-wrap items-end gap-3 mb-5">
				<label class="flex flex-col gap-1">
					<span class="text-[10px] uppercase tracking-widest text-navy-500 font-semibold">Manager</span>
					<select
						name="rosterId"
						required
						class="bg-navy-800 border border-navy-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
					>
						<option value="">Select…</option>
						{#each data.rosterList as roster}
							<option value={roster.rosterId}>{roster.teamName}</option>
						{/each}
					</select>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-[10px] uppercase tracking-widest text-navy-500 font-semibold">Season</span>
					<input
						type="text"
						name="season"
						value={data.season}
						maxlength="4"
						required
						placeholder="YYYY"
						class="w-20 bg-navy-800 border border-navy-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500 font-mono"
					/>
				</label>
				<label class="flex flex-col gap-1">
					<span class="text-[10px] uppercase tracking-widest text-navy-500 font-semibold">Reason type</span>
					<select
						name="kind"
						bind:value={promotionKind}
						class="bg-navy-800 border border-navy-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
					>
						{#each Object.entries(promotionKindLabel) as [value, label]}
							<option {value}>{label}</option>
						{/each}
					</select>
				</label>
				{#if promotionKind === 'other'}
					<label class="flex flex-col gap-1">
						<span class="text-[10px] uppercase tracking-widest text-navy-500 font-semibold">Amount (+/−)</span>
						<input
							type="number"
							name="amount"
							step="1"
							required
							placeholder="e.g. 5 or -3"
							class="w-28 bg-navy-800 border border-navy-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500 text-right"
						/>
					</label>
				{/if}
				<label class="flex flex-col gap-1 flex-1 min-w-[12rem]">
					<span class="text-[10px] uppercase tracking-widest text-navy-500 font-semibold">Reason</span>
					<input
						type="text"
						name="reason"
						required
						maxlength="120"
						placeholder="e.g. no lineup set for 3 weeks"
						class="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500"
					/>
				</label>
				<button
					type="submit"
					class="px-4 py-2 text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-lg transition-colors"
				>
					Add
				</button>
			</form>

			{#if form?.promotionError}
				<p class="text-sm text-red-400 mb-3">{form.promotionError}</p>
			{/if}

			{#if data.promotionLedger.length === 0}
				<p class="text-sm text-navy-500">No adjustments yet for {data.season}.</p>
			{:else}
				<div class="rounded-lg border border-navy-700 overflow-hidden">
					<table class="w-full text-sm">
						<thead>
							<tr class="bg-navy-900 text-left">
								<th class="px-3 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider">Manager</th>
								<th class="px-3 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider text-right">PP</th>
								<th class="px-3 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider">Kind</th>
								<th class="px-3 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider">Reason</th>
								<th class="px-3 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider">Date</th>
								<th class="px-3 py-2"></th>
							</tr>
						</thead>
						<tbody class="divide-y divide-navy-700/60">
							{#each data.promotionLedger as txn (txn.id)}
								<tr class="hover:bg-navy-800">
									<td class="px-3 py-2.5 text-slate-300 font-medium">{teamNameFor(txn.rosterId)}</td>
									<td class="px-3 py-2.5 text-right font-mono font-bold {txn.amount >= 0 ? 'text-green-400' : 'text-red-400'}">{fmtPP(txn.amount)}</td>
									<td class="px-3 py-2.5 text-slate-400 capitalize">{txn.kind}</td>
									<td class="px-3 py-2.5 text-slate-400">{txn.reason}</td>
									<td class="px-3 py-2.5 text-navy-500 whitespace-nowrap">{fmtFaabDate(txn.createdAt)}</td>
									<td class="px-3 py-2.5 text-right">
										<form method="POST" action="?/deletePromotion" use:enhance>
											<input type="hidden" name="id" value={txn.id} />
											<button type="submit" class="text-xs text-navy-500 hover:text-red-400 transition-colors" aria-label="Delete adjustment">✕</button>
										</form>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</section>
	{/if}

	<!-- ── FAAB Adjustments ── -->
	<section class="bg-navy-850 rounded-lg border border-navy-700 p-6 mb-6">
		<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-1 flex items-center gap-2"><span class="text-amber-400">◆</span>FAAB Adjustments</h2>
		<p class="text-sm text-slate-400 mb-4">
			Grant or dock FAAB outside Sleeper. Each entry is recorded as a transaction the
			league can see, and the running total is added to that team's balance on the Keepers page.
		</p>

		<!-- Add an adjustment -->
		<form method="POST" action="?/addFaab" use:enhance class="flex flex-wrap items-end gap-3 mb-5">
			<label class="flex flex-col gap-1">
				<span class="text-[10px] uppercase tracking-widest text-navy-500 font-semibold">Manager</span>
				<select
					name="rosterId"
					required
					class="bg-navy-800 border border-navy-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
				>
					<option value="">Select…</option>
					{#each data.rosterList as roster}
						<option value={roster.rosterId}>{roster.teamName}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-[10px] uppercase tracking-widest text-navy-500 font-semibold">Amount (+/−)</span>
				<input
					type="number"
					name="amount"
					step="1"
					required
					placeholder="e.g. 5 or -3"
					class="w-28 bg-navy-800 border border-navy-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500 text-right"
				/>
			</label>
			<label class="flex flex-col gap-1 flex-1 min-w-[12rem]">
				<span class="text-[10px] uppercase tracking-widest text-navy-500 font-semibold">Reason</span>
				<input
					type="text"
					name="reason"
					required
					maxlength="120"
					placeholder="e.g. trade kicker, late lineup penalty"
					class="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500"
				/>
			</label>
			<button
				type="submit"
				class="px-4 py-2 text-sm font-bold bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-lg transition-colors"
			>
				Add
			</button>
		</form>

		{#if form?.faabError}
			<p class="text-sm text-red-400 mb-3">{form.faabError}</p>
		{/if}

		<!-- Ledger -->
		{#if data.faabLedger.length === 0}
			<p class="text-sm text-navy-500">No adjustments yet.</p>
		{:else}
			<div class="rounded-lg border border-navy-700 overflow-hidden">
				<table class="w-full text-sm">
					<thead>
						<tr class="bg-navy-900 text-left">
							<th class="px-3 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider">Manager</th>
							<th class="px-3 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider text-right">Amount</th>
							<th class="px-3 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider">Reason</th>
							<th class="px-3 py-2 text-[10px] font-semibold text-navy-500 uppercase tracking-wider">Date</th>
							<th class="px-3 py-2"></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-navy-700/60">
						{#each data.faabLedger as txn (txn.id)}
							<tr class="hover:bg-navy-800">
								<td class="px-3 py-2.5 text-slate-300 font-medium">{teamNameFor(txn.rosterId)}</td>
								<td class="px-3 py-2.5 text-right font-mono font-bold {txn.amount >= 0 ? 'text-green-400' : 'text-red-400'}">{fmtFaab(txn.amount)}</td>
								<td class="px-3 py-2.5 text-slate-400">{txn.reason}</td>
								<td class="px-3 py-2.5 text-navy-500 whitespace-nowrap">{fmtFaabDate(txn.createdAt)}</td>
								<td class="px-3 py-2.5 text-right">
									<form method="POST" action="?/deleteFaab" use:enhance>
										<input type="hidden" name="id" value={txn.id} />
										<button type="submit" class="text-xs text-navy-500 hover:text-red-400 transition-colors" aria-label="Delete adjustment">✕</button>
									</form>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>

	<!-- ── Keeper Selections ── -->
	<section class="bg-navy-850 rounded-lg border border-navy-700 p-6 mb-6">
		<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-1 flex items-center gap-2"><span class="text-amber-400">◆</span>Keeper Selections</h2>
		<p class="text-sm text-slate-400 mb-4">
			Keepers designated on each team's Sleeper roster for this season. Teams with
			no keepers designated yet are shown as empty — this reflects Sleeper directly,
			the same source the draft planner uses.
		</p>

		<p class="text-2xl font-sport font-black text-white leading-none mb-4">
			{data.keeperDesignatedCount}<span class="text-slate-500 text-lg"> / {data.keeperTeams.length}</span>
			<span class="text-xs font-semibold uppercase tracking-widest text-slate-400 ml-2">teams with keepers</span>
		</p>

		<div class="space-y-2">
			{#each data.keeperTeams as team (team.rosterId)}
				<div class="rounded-lg border border-navy-700 px-4 py-3 {team.players.length > 0 ? 'bg-navy-900' : 'bg-navy-900/40'}">
					<div class="flex items-center justify-between gap-3 mb-1.5">
						<span class="font-semibold text-white text-sm truncate min-w-0">{team.teamName}</span>
						<span class="shrink-0 text-[10px] uppercase tracking-widest font-semibold text-navy-500">{team.players.length} keeper{team.players.length === 1 ? '' : 's'}</span>
					</div>
					{#if team.players.length === 0}
						<p class="text-xs text-navy-500 italic">No keepers designated on Sleeper yet.</p>
					{:else}
						<ul class="flex flex-wrap gap-x-4 gap-y-1">
							{#each team.players as player (player.playerId)}
								<li class="flex items-center gap-1.5 text-sm">
									<span class="text-[10px] font-semibold {posColor(player.pos)} w-6 shrink-0">{player.pos}</span>
									<span class="text-slate-200">{player.name}</span>
									<span class="text-navy-500 text-xs">{player.team}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			{/each}
		</div>
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
