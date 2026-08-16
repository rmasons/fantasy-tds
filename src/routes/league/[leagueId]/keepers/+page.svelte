<script lang="ts">
	import type { PageData } from './$types';
	import type { KeeperRosterData, KeeperSelection } from '$lib/server/keepers';
	import { computeScenario } from '$lib/keeperCost';
	import type { ScenarioPlayer } from '$lib/keeperCost';
	import { onMount } from 'svelte';

	let { data } = $props<{ data: PageData }>();

	// ── State ──────────────────────────────────────────────────────────────
	let rosters = $state<KeeperRosterData[]>([]);
	let planningYear = $state('');
	let maxKeepers = $state(0);
	let faabBudget = $state(0);
	let loading = $state(true);
	let fetchError = $state('');

	// checked[playerId] = true means "keeping this player" (own roster, for submission)
	let checked = $state<Record<string, boolean>>({});

	// ── Scenario Builder state ─────────────────────────────────────────────
	// scenarioChecked is a separate layer: any visitor can toggle any player
	// to build a what-if scenario without affecting their submission.
	// When the user submits their real keepers, their real checked state is used.
	// The scenario panel reflects scenarioChecked for all rosters.
	let scenarioMode = $state(false);
	let scenarioChecked = $state<Record<string, boolean>>({});

	// When scenario mode is toggled on, pre-populate from current checked state.
	function toggleScenarioMode() {
		if (!scenarioMode) {
			// Copy the current keeper selections into the scenario layer.
			scenarioChecked = { ...checked };
		}
		scenarioMode = !scenarioMode;
	}

	// Reset the scenario to the submitted/checked state for a single roster.
	function resetRosterScenario(roster: KeeperRosterData) {
		const next = { ...scenarioChecked };
		for (const p of roster.players) {
			if (checked[p.playerId]) {
				next[p.playerId] = true;
			} else {
				delete next[p.playerId];
			}
		}
		scenarioChecked = next;
	}

	// Clear all scenario picks for a single roster.
	function clearRosterScenario(roster: KeeperRosterData) {
		const next = { ...scenarioChecked };
		for (const p of roster.players) delete next[p.playerId];
		scenarioChecked = next;
	}

	function scenarioTogglePlayer(playerId: string, roster: KeeperRosterData) {
		const alreadyOn = scenarioChecked[playerId];
		if (!alreadyOn) {
			// Enforce max keepers per roster in scenario mode too.
			const rosterCount = roster.players.filter(p => scenarioChecked[p.playerId]).length;
			if (maxKeepers > 0 && rosterCount >= maxKeepers) return;
		}
		scenarioChecked = { ...scenarioChecked, [playerId]: !alreadyOn };
		if (!scenarioChecked[playerId]) {
			const next = { ...scenarioChecked };
			delete next[playerId];
			scenarioChecked = next;
		}
	}

	// Per-roster scenario totals (pure, uses computeScenario from keeperCost.ts).
	function rosterScenario(roster: KeeperRosterData) {
		const selectedIds = new Set(
			roster.players.filter(p => scenarioChecked[p.playerId]).map(p => p.playerId)
		);
		const sp: ScenarioPlayer[] = roster.players.map(p => ({
			playerId: p.playerId,
			keeperCost: p.keeperCost,
		}));
		return computeScenario(selectedIds, sp, roster.faabRemaining, maxKeepers);
	}

	// League-wide scenario summary across ALL rosters.
	const scenarioLeagueSummary = $derived.by(() => {
		if (!scenarioMode || rosters.length === 0) return null;
		let totalCount = 0;
		let totalCost = 0;
		let teamsOverLimit = 0;
		let teamsOverBudget = 0;

		for (const r of rosters) {
			const s = rosterScenario(r);
			totalCount += s.count;
			totalCost += s.totalCost;
			if (s.overLimit) teamsOverLimit++;
			if (s.faabAfter !== null && s.faabAfter < 0) teamsOverBudget++;
		}
		return { totalCount, totalCost, teamsOverLimit, teamsOverBudget };
	});

	// Keeper selections (submitted by managers)
	let selections = $state<Record<string, KeeperSelection>>({});
	let submitting = $state(false);
	let submitError = $state('');

	// ── Load data ──────────────────────────────────────────────────────────
	async function load() {
		loading = true;
		fetchError = '';
		try {
			const [rosterRes, selectRes] = await Promise.all([
				fetch(`/api/keepers?leagueId=${encodeURIComponent(data.leagueId)}`),
				fetch(`/api/keeper-selections?leagueId=${encodeURIComponent(data.leagueId)}`),
			]);
			if (!rosterRes.ok) throw new Error(`HTTP ${rosterRes.status}`);
			const d = await rosterRes.json();
			rosters = d.rosters;
			planningYear = d.planningYear;
			maxKeepers = d.maxKeepers ?? 0;
			faabBudget = d.faabBudget ?? 0;

			const newChecked: Record<string, boolean> = {};
			if (selectRes.ok) {
				const sd = await selectRes.json();
				selections = Object.fromEntries(
					(sd.selections as KeeperSelection[]).map((s: KeeperSelection) => [s.ownerUserId, s])
				);
				const myUserId = data.user?.sleeperUserId;
				if (myUserId && selections[myUserId]) {
					for (const pid of selections[myUserId].playerIds) {
						newChecked[pid] = true;
					}
				}
			} else {
				selections = {};
			}
			checked = newChecked;
		} catch (e: any) {
			fetchError = e.message;
		} finally {
			loading = false;
		}
	}

	let expandedRow = $state<number | null>(null);
	let colCount = $state(1);

	onMount(() => {
		function updateCols() {
			const next = window.innerWidth >= 1280 ? 3 : window.innerWidth >= 768 ? 2 : 1;
			if (next !== colCount) {
				colCount = next;
				expandedRow = null;
			}
		}
		updateCols();
		window.addEventListener('resize', updateCols);

		// Async load runs in the background so onMount can return its cleanup synchronously.
		(async () => {
			await load();
			if (data.user?.sleeperUserId) {
				const idx = rosters.findIndex(r => r.ownerUserId === data.user!.sleeperUserId);
				if (idx !== -1) expandedRow = Math.floor(idx / colCount);
			}
		})();

		return () => window.removeEventListener('resize', updateCols);
	});

	function toggle(i: number) {
		const row = Math.floor(i / colCount);
		expandedRow = expandedRow === row ? null : row;
	}

	function isExpanded(i: number): boolean {
		return Math.floor(i / colCount) === expandedRow;
	}

	// ── Derived totals (own roster / submission layer) ─────────────────────
	function rosterTotal(roster: KeeperRosterData): number {
		return roster.players
			.filter(p => checked[p.playerId] && p.keeperCost !== null)
			.reduce((s, p) => s + p.keeperCost!, 0);
	}

	function rosterKeeperCount(roster: KeeperRosterData): number {
		return roster.players.filter(p => checked[p.playerId]).length;
	}

	function rosterFaabAfter(roster: KeeperRosterData): number {
		return roster.faabRemaining - rosterTotal(roster);
	}

	function atKeeperLimit(roster: KeeperRosterData): boolean {
		return maxKeepers > 0 && rosterKeeperCount(roster) >= maxKeepers;
	}

	// Identify the logged-in manager's own roster
	const myRoster = $derived(
		data.user?.sleeperUserId
			? rosters.find(r => r.ownerUserId === data.user!.sleeperUserId) ?? null
			: null
	);
	const myKeeperCost = $derived(myRoster ? rosterTotal(myRoster) : 0);
	const myFaabAfter = $derived(myRoster ? rosterFaabAfter(myRoster) : null);
	const myCount = $derived(myRoster ? rosterKeeperCount(myRoster) : 0);

	// ── Cost helpers ───────────────────────────────────────────────────────
	function fmt(n: number | null): string {
		if (n === null) return '—';
		return `$${n}`;
	}

	function posColor(pos: string): string {
		return (
			pos === 'QB'  ? 'text-red-400'    :
			pos === 'RB'  ? 'text-green-400'  :
			pos === 'WR'  ? 'text-slate-300'   :
			pos === 'TE'  ? 'text-amber-400'  :
			pos === 'K'   ? 'text-slate-400'  :
			pos === 'DEF' ? 'text-purple-400' :
			'text-slate-500'
		);
	}

	// ── Keeper submission ──────────────────────────────────────────────────
	async function submitKeepers() {
		if (!myRoster || !data.user?.sleeperUserId) return;
		submitting = true;
		submitError = '';
		try {
			const playerIds = myRoster.players
				.filter(p => checked[p.playerId])
				.map(p => p.playerId);
			const res = await fetch(
				`/api/keeper-selections?leagueId=${encodeURIComponent(data.leagueId)}`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ rosterId: myRoster.rosterId, playerIds }),
				},
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const d = await res.json();
			selections = { ...selections, [data.user.sleeperUserId]: d.selection };
		} catch (e: any) {
			submitError = e.message;
		} finally {
			submitting = false;
		}
	}

	function formatSubmittedAt(iso: string): string {
		return new Date(iso).toLocaleString('en-US', {
			month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
		});
	}
</script>

<div>
	<!-- ── Header ── -->
	<div class="flex items-start justify-between mb-4 flex-wrap gap-3">
		<div>
			<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">
				Keepers
				{#if planningYear}<span class="text-slate-500 font-normal text-lg ml-2">{planningYear}</span>{/if}
			</h1>
			{#if !loading && !fetchError}
				{@const submittedCount = Object.keys(selections).length}
				<p class="text-sm text-slate-500 mt-0.5">
					<span class="{submittedCount > 0 ? 'text-green-400 font-semibold' : ''}">{submittedCount}/{rosters.length} submitted</span>
					{#if myKeeperCost > 0}· <span class="text-amber-400 font-semibold">${myKeeperCost} your cost</span>{/if}
					{#if maxKeepers > 0}· <span class="text-slate-400">max {maxKeepers} per team</span>{/if}
				</p>
			{/if}
			<p class="text-xs text-slate-600 mt-1 font-mono whitespace-nowrap">
				salary = base × (1 + (0.20 × (years kept + 1)))
			</p>
		</div>

		<div class="flex items-center gap-2 flex-wrap">
			{#if !loading && !fetchError}
				<button
					onclick={toggleScenarioMode}
					class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-bold uppercase tracking-wide transition-colors
					       {scenarioMode
					         ? 'border-blue-400 bg-blue-400/15 text-blue-300 hover:bg-blue-400/25'
					         : 'border-slate-600 bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:border-slate-500'}"
				>
					{scenarioMode ? '✕ Exit Planner' : '⚡ Scenario Planner'}
				</button>
			{/if}
		</div>
	</div>

	<!-- ── My FAAB banner (logged-in manager only, not in scenario mode) ── -->
	{#if !loading && !fetchError && myRoster && myFaabAfter !== null && !scenarioMode}
		<div class="mb-6 rounded-xl border {myFaabAfter < 0 ? 'border-red-500/40 bg-red-950/20' : 'border-amber-500/20 bg-amber-950/10'} px-4 py-3 flex items-center gap-4 flex-wrap">
			<div class="flex items-center gap-2 shrink-0">
				{#if myRoster.ownerAvatar}
					<img src={myRoster.ownerAvatar} alt="" class="w-6 h-6 rounded-full object-cover ring-1 ring-slate-700" />
				{/if}
				<span class="text-sm font-semibold text-white">Your team</span>
			</div>
			<div class="flex items-center gap-4 text-sm flex-wrap">
				<span class="text-slate-400">
					FAAB available: <span class="font-bold text-white">${myRoster.faabRemaining}</span>
				</span>
				{#if myKeeperCost > 0}
					<span class="text-slate-500">−</span>
					<span class="text-slate-400">
						Keeper cost: <span class="font-bold text-amber-400">${myKeeperCost}</span>
					</span>
					<span class="text-slate-500">=</span>
					<span class="font-bold {myFaabAfter < 0 ? 'text-red-400' : 'text-green-400'}">
						${myFaabAfter} remaining
					</span>
				{/if}
			</div>
			{#if maxKeepers > 0}
				<span class="ml-auto text-xs {myCount >= maxKeepers ? 'text-amber-400 font-bold' : 'text-slate-500'} shrink-0">
					{myCount}/{maxKeepers} keepers
				</span>
			{/if}
		</div>
	{/if}

	<!-- ── Scenario Builder Summary Panel ── -->
	{#if scenarioMode && !loading && !fetchError}
		<div class="mb-6 rounded-xl border border-blue-500/30 bg-blue-950/20 p-4">
			<!-- Panel header -->
			<div class="flex items-center justify-between mb-3 flex-wrap gap-2">
				<div>
					<p class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300">Scenario Planner</p>
					<p class="text-xs text-slate-500 mt-0.5">Toggle any player on any roster to see the hypothetical cost impact. Your real submission is unchanged.</p>
				</div>
			</div>

			<!-- League-wide totals -->
			{#if scenarioLeagueSummary}
				<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
					<div class="bg-navy-850 rounded-lg border border-navy-700 px-3 py-2.5 text-center">
						<p class="text-2xl font-sport font-black text-white leading-none">{scenarioLeagueSummary.totalCount}</p>
						<p class="text-xs text-slate-500 uppercase tracking-widest mt-1">Total kept</p>
					</div>
					<div class="bg-navy-850 rounded-lg border border-navy-700 px-3 py-2.5 text-center">
						<p class="text-2xl font-sport font-black text-amber-400 leading-none">${scenarioLeagueSummary.totalCost}</p>
						<p class="text-xs text-slate-500 uppercase tracking-widest mt-1">Total cost</p>
					</div>
					<div class="bg-navy-850 rounded-lg border {scenarioLeagueSummary.teamsOverLimit > 0 ? 'border-red-500/40 bg-red-950/10' : 'border-navy-700'} px-3 py-2.5 text-center">
						<p class="text-2xl font-sport font-black {scenarioLeagueSummary.teamsOverLimit > 0 ? 'text-red-400' : 'text-green-400'} leading-none">{scenarioLeagueSummary.teamsOverLimit}</p>
						<p class="text-xs text-slate-500 uppercase tracking-widest mt-1">Over limit</p>
					</div>
					<div class="bg-navy-850 rounded-lg border {scenarioLeagueSummary.teamsOverBudget > 0 ? 'border-red-500/40 bg-red-950/10' : 'border-navy-700'} px-3 py-2.5 text-center">
						<p class="text-2xl font-sport font-black {scenarioLeagueSummary.teamsOverBudget > 0 ? 'text-red-400' : 'text-green-400'} leading-none">{scenarioLeagueSummary.teamsOverBudget}</p>
						<p class="text-xs text-slate-500 uppercase tracking-widest mt-1">Over budget</p>
					</div>
				</div>
			{/if}

			<!-- Per-roster scenario summary rows -->
			<div class="space-y-1.5">
				{#each rosters as roster (roster.rosterId)}
					{@const s = rosterScenario(roster)}
					<div class="flex items-center gap-3 px-3 py-2 rounded-lg bg-navy-850 border {s.overLimit || (s.faabAfter !== null && s.faabAfter < 0) ? 'border-red-500/30' : 'border-navy-700/60'} flex-wrap">
						<div class="flex items-center gap-2 min-w-0 flex-1">
							{#if roster.ownerAvatar}
								<img src={roster.ownerAvatar} alt="" class="w-5 h-5 rounded-full object-cover ring-1 ring-slate-700 shrink-0" />
							{:else}
								<div class="w-5 h-5 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-[9px] shrink-0">🏈</div>
							{/if}
							<span class="text-sm font-semibold text-white truncate">{roster.ownerName}</span>
						</div>

						<div class="flex items-center gap-3 shrink-0 text-xs">
							<!-- Count -->
							<span class="{s.overLimit ? 'text-red-400 font-bold' : 'text-slate-400'}">
								{s.count}{maxKeepers > 0 ? `/${maxKeepers}` : ''} kept
							</span>
							<!-- Cost -->
							<span class="text-amber-400 font-semibold w-12 text-right">${s.totalCost}</span>
							<!-- FAAB after -->
							{#if s.faabAfter !== null}
								<span class="text-slate-500">→</span>
								<span class="font-semibold w-14 text-right {s.faabAfter < 0 ? 'text-red-400' : 'text-green-400'}">${s.faabAfter}</span>
							{/if}
							<!-- Per-roster quick actions -->
							<button
								onclick={() => clearRosterScenario(roster)}
								title="Clear scenario picks for {roster.ownerName}"
								class="text-slate-600 hover:text-slate-400 transition-colors ml-1 px-1"
							>✕</button>
							<button
								onclick={() => resetRosterScenario(roster)}
								title="Reset to submitted picks for {roster.ownerName}"
								class="text-slate-600 hover:text-slate-400 transition-colors px-1"
							>↺</button>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- ── Loading / error ── -->
	{#if loading}
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
			{#each Array(6) as _}
				<div class="h-64 bg-navy-850 rounded-lg animate-pulse"></div>
			{/each}
		</div>
	{:else if fetchError}
		<div class="bg-navy-850 rounded-lg border border-navy-700 p-6 text-center">
			<p class="text-navy-500 mb-1">Failed to load keeper data.</p>
			<p class="text-navy-500 text-sm">{fetchError}</p>
			<button onclick={load} class="mt-3 px-4 py-1.5 text-sm bg-navy-800 hover:bg-navy-700 rounded-lg text-slate-200 transition-colors">
				Retry
			</button>
		</div>
	{:else}
		<!-- ── Roster grid ── -->
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
			{#each rosters as roster, i (roster.rosterId)}
				{@const total = rosterTotal(roster)}
				{@const count = rosterKeeperCount(roster)}
				{@const faabLeft = rosterFaabAfter(roster)}
				{@const isMyRoster = roster.ownerUserId === data.user?.sleeperUserId}
				{@const mySelection = selections[roster.ownerUserId]}
				{@const sc = scenarioMode ? rosterScenario(roster) : null}
				<div class="bg-navy-850 rounded-lg border {isMyRoster ? 'border-amber-500/40 ring-1 ring-amber-500/20' : 'border-navy-700'} overflow-hidden">
					<!-- Roster header -->
					<button
						onclick={() => toggle(i)}
						class="w-full flex items-center gap-2.5 px-4 py-3 bg-navy-900 hover:bg-navy-800 transition-colors text-left
						       {isExpanded(i) ? 'border-b border-navy-700' : ''}"
					>
						{#if roster.ownerAvatar}
							<img src={roster.ownerAvatar} alt="" class="w-7 h-7 rounded-full object-cover ring-1 ring-slate-700 shrink-0" />
						{:else}
							<div class="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-xs shrink-0">🏈</div>
						{/if}
						<span class="font-semibold text-white text-sm truncate min-w-0">{roster.ownerName}</span>
						{#if scenarioMode && sc}
							<!-- Scenario totals in header -->
							<span class="ml-auto flex items-center gap-1.5 shrink-0">
								{#if sc.overLimit}
									<span class="text-xs font-bold text-red-400">OVER</span>
								{/if}
								<span class="text-xs font-semibold text-blue-300">{sc.count}{maxKeepers > 0 ? `/${maxKeepers}` : ''}</span>
								<span class="text-xs font-bold text-amber-400">${sc.totalCost}</span>
								{#if sc.faabAfter !== null}
									<span class="text-xs font-semibold {sc.faabAfter < 0 ? 'text-red-400' : 'text-slate-400'}">→ ${sc.faabAfter}</span>
								{/if}
							</span>
						{:else}
							<span class="text-xs font-bold text-amber-400 shrink-0 ml-auto">${roster.faabRemaining}</span>
						{/if}
						<span class="text-navy-500 text-xs shrink-0">{isExpanded(i) ? '▲' : '▼'}</span>
					</button>

					{#if isExpanded(i)}
						<!-- Player rows -->
						<div class="divide-y divide-navy-700/40">
							{#each roster.players as player}
								{@const inScenario = scenarioMode && scenarioChecked[player.playerId]}
								{@const scenarioAtLimit = scenarioMode && !scenarioChecked[player.playerId] && maxKeepers > 0 && roster.players.filter(p => scenarioChecked[p.playerId]).length >= maxKeepers}
								<div class="px-3 py-2 {inScenario ? 'bg-blue-500/5' : checked[player.playerId] ? 'bg-amber-500/5' : ''}">
									<div class="flex items-center gap-2">
										{#if scenarioMode}
											<!-- Scenario toggle: available for ANY roster -->
											<input
												type="checkbox"
												checked={scenarioChecked[player.playerId] ?? false}
												disabled={scenarioAtLimit}
												onchange={() => scenarioTogglePlayer(player.playerId, roster)}
												class="accent-blue-400 w-3.5 h-3.5 shrink-0 rounded cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
											/>
										{:else if isMyRoster}
											<input
												type="checkbox"
												bind:checked={checked[player.playerId]}
												disabled={!checked[player.playerId] && atKeeperLimit(roster)}
												class="accent-amber-400 w-3.5 h-3.5 shrink-0 rounded cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
											/>
										{:else}
											<span class="w-3.5 h-3.5 shrink-0"></span>
										{/if}
										<span class="text-xs font-semibold {posColor(player.pos)} w-6 shrink-0">{player.pos}</span>
										<span class="text-sm text-white truncate flex-1">{player.name}</span>
										<div class="flex items-center gap-2 shrink-0 text-right">
											<span class="text-xs text-slate-500" title="Base cost · years kept">
												{fmt(player.baseCost)} × {1 + (0.2 * (player.yearsKept + 1))}
											</span>
											<span class="text-sm font-semibold w-10 text-right text-amber-400">
												{fmt(player.keeperCost)}
											</span>
										</div>
									</div>
									<div class="flex justify-between ml-6 mt-0.5">
										{#if player.draftSeason}
											<span class="text-xs text-slate-700 leading-none">
												R{player.draftRound} · {player.draftSeason}
											</span>
										{:else}
											<span></span>
										{/if}
										<span class="text-xs text-slate-500 leading-none whitespace-nowrap text-right">
											Years kept: {player.yearsKept}
										</span>
									</div>
								</div>
							{/each}
						</div>

						<!-- Roster footer -->
						{#if scenarioMode}
							<!-- Scenario footer: show scenario totals + per-roster actions -->
							{#if sc}
								<div class="px-4 py-2.5 border-t border-blue-900/50 bg-blue-950/10">
									<div class="flex items-center justify-between gap-3 flex-wrap">
										<div class="text-xs text-slate-400 leading-snug">
											<span class="font-semibold text-blue-300">{sc.count}{maxKeepers > 0 ? `/${maxKeepers}` : ''} kept</span>
											· <span class="text-amber-400 font-semibold">${sc.totalCost} cost</span>
											{#if sc.faabAfter !== null}
												· <span class="font-semibold {sc.faabAfter < 0 ? 'text-red-400' : 'text-green-400'}">${sc.faabAfter} left</span>
											{/if}
											{#if sc.overLimit}
												<span class="ml-1.5 text-red-400 font-bold uppercase text-[10px]">Over limit!</span>
											{/if}
										</div>
										<div class="flex gap-1.5">
											<button
												onclick={() => clearRosterScenario(roster)}
												class="px-2 py-1 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors"
											>Clear</button>
											<button
												onclick={() => resetRosterScenario(roster)}
												class="px-2 py-1 text-xs text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors"
											>Reset</button>
										</div>
									</div>
								</div>
							{/if}
						{:else if isMyRoster}
							<div class="px-4 py-2.5 border-t border-navy-700 bg-navy-900">
								{#if count > 0}
									<div class="flex items-center justify-between mb-2">
										<span class="text-xs text-slate-500">
											{count}{maxKeepers > 0 ? `/${maxKeepers}` : ''} keeper{count !== 1 ? 's' : ''} · <span class="text-amber-400">${total}</span>
										</span>
										<span class="text-sm font-bold {faabLeft < 0 ? 'text-red-400' : 'text-green-400'}">
											${faabLeft} left
										</span>
									</div>
								{/if}
								<div class="flex items-center justify-between gap-3">
									{#if mySelection}
										<span class="text-xs text-green-400 leading-tight">
											✓ Submitted {formatSubmittedAt(mySelection.submittedAt)}
										</span>
										<button
											onclick={submitKeepers}
											disabled={submitting}
											class="px-3 py-1 text-xs font-semibold bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-200 rounded-lg transition-colors shrink-0"
										>
											{submitting ? 'Saving…' : 'Update'}
										</button>
									{:else}
										<span class="text-xs text-slate-500">Not yet submitted</span>
										<button
											onclick={submitKeepers}
											disabled={submitting}
											class="px-3 py-1 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-900 rounded-lg transition-colors shrink-0"
										>
											{submitting ? 'Saving…' : 'Submit keepers'}
										</button>
									{/if}
								</div>
								{#if submitError}
									<p class="text-xs text-red-400 mt-1">{submitError}</p>
								{/if}
							</div>
						{/if}
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
