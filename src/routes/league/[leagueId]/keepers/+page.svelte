<script lang="ts">
	import type { PageData } from './$types';
	import type { KeeperRosterData, KeeperSelection } from '$lib/server/keepers';
	import FaabEasterEgg from '$lib/components/FaabEasterEgg.svelte';
	import { onMount } from 'svelte';

	let { data } = $props<{ data: PageData }>();

	const TOTAL_EGGS = 12;
	let huntOpen = $state(false);
	let huntClaimed = $state(0);
	let huntLoading = $state(false);

	async function openHunt() {
		huntOpen = true;
		if (huntLoading || huntClaimed > 0) return;
		huntLoading = true;
		try {
			const res = await fetch(`/api/faab-eggs/${data.leagueId}`);
			if (res.ok) huntClaimed = Object.keys(await res.json()).length;
		} catch {
			// fail silently — count is non-critical
		} finally {
			huntLoading = false;
		}
	}

	// ── State ──────────────────────────────────────────────────────────────
	let rosters = $state<KeeperRosterData[]>([]);
	let planningYear = $state('');
	let maxKeepers = $state(0);
	let loading = $state(true);
	let fetchError = $state('');

	// checked[playerId] = true means "keeping this player"
	let checked = $state<Record<string, boolean>>({});

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

	onMount(async () => {
		function updateCols() {
			const next = window.innerWidth >= 1280 ? 3 : window.innerWidth >= 768 ? 2 : 1;
			if (next !== colCount) {
				colCount = next;
				expandedRow = null;
			}
		}
		updateCols();
		window.addEventListener('resize', updateCols);

		await load();
		if (data.user?.sleeperUserId) {
			const idx = rosters.findIndex(r => r.ownerUserId === data.user!.sleeperUserId);
			if (idx !== -1) expandedRow = Math.floor(idx / colCount);
		}

		return () => window.removeEventListener('resize', updateCols);
	});

	function toggle(i: number) {
		const row = Math.floor(i / colCount);
		expandedRow = expandedRow === row ? null : row;
	}

	function isExpanded(i: number): boolean {
		return Math.floor(i / colCount) === expandedRow;
	}

	// ── Derived totals ─────────────────────────────────────────────────────
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
				salary = base × (1 + (0.20 × (years kept + 1)))<FaabEasterEgg eggId="3" leagueId={data.leagueId} loggedIn={!!data.user} />
			</p>
		</div>

		<div class="flex items-center gap-2 flex-wrap">
			<button
				onclick={openHunt}
				class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 text-amber-400 text-xs font-bold uppercase tracking-wide hover:bg-amber-400/20 hover:border-amber-400 transition-colors"
			>💰 FAAB Hunt</button>
		</div>
	</div>

	<!-- ── My FAAB banner (logged-in manager only) ── -->
	{#if !loading && !fetchError && myRoster && myFaabAfter !== null}
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
						<span class="font-semibold text-white text-sm truncate flex-1">{roster.ownerName}</span>
						<div class="flex items-center gap-2 shrink-0">
							{#if mySelection}
								<span class="text-xs text-green-400 font-semibold">✓ {mySelection.playerIds.length}</span>
							{:else if isMyRoster}
								<span class="text-xs {count > 0 ? 'text-amber-400 font-semibold' : 'text-slate-500'}">
									{count > 0 ? `${count} sel.` : 'pick keepers'}
								</span>
							{:else}
								<span class="text-xs text-slate-600">pending</span>
							{/if}
							<span class="text-navy-500 text-xs ml-1">{isExpanded(i) ? '▲' : '▼'}</span>
						</div>
					</button>

					{#if isExpanded(i)}
						<!-- Player rows -->
						<div class="divide-y divide-navy-700/40">
							{#each roster.players as player}
								<div class="px-3 py-2 {checked[player.playerId] ? 'bg-amber-500/5' : ''}">
									<div class="flex items-center gap-2">
										{#if isMyRoster}
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
						{#if isMyRoster}
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


{#if huntOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background:rgba(0,0,0,0.85);backdrop-filter:blur(4px)">
		<div class="bg-navy-850 border border-amber-500/30 rounded-2xl p-8 max-w-md w-full shadow-2xl">
			<div class="text-4xl mb-4 text-center">💰</div>
			<h2 class="font-sport font-black text-2xl uppercase text-amber-400 text-center leading-tight mb-1">FAAB Hunt</h2>
			<p class="text-center text-navy-500 text-xs uppercase tracking-widest font-semibold mb-6">
				{#if huntLoading}
					Loading…
				{:else}
					{huntClaimed} / {TOTAL_EGGS} claimed · {TOTAL_EGGS - huntClaimed} remaining
				{/if}
			</p>

			<div class="space-y-3 mb-7 text-sm text-slate-300 leading-relaxed text-center">
				<p>We've hidden <span class="text-amber-400 font-bold">{TOTAL_EGGS} secret $5 FAAB bonuses</span> across the site.</p>
				<p>When you find the <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-400/50 bg-amber-400/10 text-amber-400 text-[10px] font-bold uppercase">💰 $5</span> badge, click it to claim your bonus.</p>
				<p>Take a screenshot of the <span class="font-semibold text-white">Congratulations</span> screen and send it to the league group text to collect.</p>
				<p class="text-navy-500 text-xs">Each bonus can only be claimed once — first come, first served. You must be signed in to claim. Maximum of 3 per person.</p>
			</div>

			<button
				onclick={() => { huntOpen = false; }}
				class="w-full py-3 bg-amber-500 hover:bg-amber-400 text-navy-950 font-sport font-bold uppercase tracking-wide rounded-xl transition-colors text-sm"
			>Let's Hunt!</button>
		</div>
	</div>
{/if}
