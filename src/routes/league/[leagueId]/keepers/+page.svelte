<script lang="ts">
	import type { PageData } from './$types';
	import type { KeeperPlayerData, KeeperRosterData, KeeperSelection } from '$lib/server/keepers';
	import FaabEasterEgg from '$lib/components/FaabEasterEgg.svelte';
	import { onMount } from 'svelte';

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

	let { data } = $props<{ data: PageData }>();

	// ── State ──────────────────────────────────────────────────────────────
	let rosters = $state<KeeperRosterData[]>([]);
	let planningYear = $state('');
	let maxKeepers = $state(0);
	let loading = $state(true);
	let fetchError = $state('');

	// checked[playerId] = true means "keeping this player"
	let checked = $state<Record<string, boolean>>({});

	// Commissioner mode
	let isCommish = $state(false);
	let editingId = $state<string | null>(null);
	let editYears = $state(0);
	let editBase = $state<string>('');
	let saving = $state(false);
	let saveError = $state('');

	// Import modal
	let showImport = $state(false);
	let importJson = $state('');
	let importing = $state(false);
	let importMsg = $state('');

	// Keeper selections (submitted by managers)
	let selections = $state<Record<string, KeeperSelection>>({});
	let submitting = $state(false);
	let submitError = $state('');

	// Draft cache refresh
	let refreshing = $state(false);
	let refreshError = $state('');

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

	let expandedRosterId = $state<number | null>(null);

	onMount(async () => {
		await load();
		if (data.user?.sleeperUserId) {
			const mine = rosters.find(r => r.ownerUserId === data.user!.sleeperUserId);
			if (mine) expandedRosterId = mine.rosterId;
		}
	});

	function toggle(rosterId: number) {
		expandedRosterId = expandedRosterId === rosterId ? null : rosterId;
	}

	function isExpanded(rosterId: number): boolean {
		return expandedRosterId === rosterId;
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

	// ── Edit helpers ───────────────────────────────────────────────────────
	function startEdit(p: KeeperPlayerData) {
		editingId = p.playerId;
		editYears = p.yearsKept;
		editBase = p.baseOverride !== null ? String(p.baseOverride) : '';
		saveError = '';
	}

	function cancelEdit() {
		editingId = null;
		saveError = '';
	}

	async function saveEdit(playerId: string) {
		saving = true;
		saveError = '';
		const body: Record<string, unknown> = { playerId, yearsKept: editYears };
		const baseNum = editBase.trim() === '' ? null : Number(editBase);
		body.baseOverride = (editBase.trim() === '' || isNaN(baseNum!)) ? null : baseNum;

		try {
			const res = await fetch(`/api/keepers?leagueId=${encodeURIComponent(data.leagueId)}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			editingId = null;
			await load();
		} catch (e: any) {
			saveError = e.message;
		} finally {
			saving = false;
		}
	}

	async function resetPlayer(playerId: string) {
		saving = true;
		saveError = '';
		try {
			const res = await fetch(
				`/api/keepers?leagueId=${encodeURIComponent(data.leagueId)}&playerId=${encodeURIComponent(playerId)}`,
				{ method: 'DELETE' },
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			editingId = null;
			await load();
		} catch (e: any) {
			saveError = e.message;
		} finally {
			saving = false;
		}
	}

	// ── Import ─────────────────────────────────────────────────────────────
	async function runImport() {
		importing = true;
		importMsg = '';
		try {
			const players = JSON.parse(importJson);
			if (!Array.isArray(players)) throw new Error('Expected a JSON array');
			const res = await fetch(`/api/keepers?leagueId=${encodeURIComponent(data.leagueId)}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ players }),
			});
			const d = await res.json();
			if (!res.ok) throw new Error(d.message ?? `HTTP ${res.status}`);
			importMsg = `Imported ${d.imported} player(s).`;
			importJson = '';
			await load();
		} catch (e: any) {
			importMsg = `Error: ${e.message}`;
		} finally {
			importing = false;
		}
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

	// ── Draft cache refresh ────────────────────────────────────────────────
	async function refreshDraftCache() {
		refreshing = true;
		refreshError = '';
		try {
			const res = await fetch(
				`/api/keepers?leagueId=${encodeURIComponent(data.leagueId)}&action=invalidate-cache`,
				{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			await load();
		} catch (e: any) {
			refreshError = e.message;
		} finally {
			refreshing = false;
		}
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
			{#if data.user?.isAdmin}
				<label class="flex items-center gap-2 text-sm text-slate-400 cursor-pointer select-none">
					<input
						type="checkbox"
						bind:checked={isCommish}
						class="accent-amber-400 w-4 h-4 rounded"
					/>
					Commissioner mode
				</label>
			{/if}
			{#if isCommish}
				<button
					onclick={() => { showImport = true; importMsg = ''; }}
					class="px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors"
				>
					Import pre-Sleeper
				</button>
				<button
					onclick={refreshDraftCache}
					disabled={refreshing}
					class="px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors disabled:opacity-40"
				>
					{refreshing ? 'Refreshing…' : 'Refresh draft cache'}
				</button>
			{/if}
		</div>
	</div>
	{#if refreshError}
		<p class="mb-3 text-xs text-red-400">Cache refresh failed: {refreshError}</p>
	{/if}

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
			{#each rosters as roster (roster.rosterId)}
				{@const total = rosterTotal(roster)}
				{@const count = rosterKeeperCount(roster)}
				{@const faabLeft = rosterFaabAfter(roster)}
				{@const isMyRoster = roster.ownerUserId === data.user?.sleeperUserId}
				{@const mySelection = selections[roster.ownerUserId]}
				<div class="bg-navy-850 rounded-lg border {isMyRoster ? 'border-amber-500/40 ring-1 ring-amber-500/20' : 'border-navy-700'} overflow-hidden">
					<!-- Roster header -->
					<button
						onclick={() => toggle(roster.rosterId)}
						class="w-full flex items-center gap-2.5 px-4 py-3 bg-navy-900 hover:bg-navy-800 transition-colors text-left
						       {isExpanded(roster.rosterId) ? 'border-b border-navy-700' : ''}"
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
							<span class="text-navy-500 text-xs ml-1">{isExpanded(roster.rosterId) ? '▲' : '▼'}</span>
						</div>
					</button>

					{#if isExpanded(roster.rosterId)}
						<!-- Player rows -->
						<div class="divide-y divide-navy-700/40">
							{#each roster.players as player}
								{@const isEditing = isCommish && editingId === player.playerId}
								<div class="px-3 py-2 {checked[player.playerId] ? 'bg-amber-500/5' : ''}">
									{#if isEditing}
										<!-- Inline edit form -->
										<div class="space-y-2">
											<div class="flex items-center gap-1.5">
												<span class="text-xs font-semibold {posColor(player.pos)} w-6 shrink-0">{player.pos}</span>
												<span class="text-sm text-white font-medium truncate">{player.name}</span>
											</div>
											<div class="flex gap-2">
												<div class="flex-1">
													<label for="edit-years-{player.playerId}" class="text-xs text-slate-500 block mb-0.5">Years kept</label>
													<input
														id="edit-years-{player.playerId}"
														type="number"
														min="0"
														bind:value={editYears}
														class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-amber-400"
													/>
												</div>
												<div class="flex-1">
													<label for="edit-base-{player.playerId}" class="text-xs text-slate-500 block mb-0.5">Base override ($)</label>
													<input
														id="edit-base-{player.playerId}"
														type="number"
														min="0"
														placeholder="auto"
														bind:value={editBase}
														class="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-amber-400 placeholder:text-slate-600"
													/>
												</div>
											</div>
											{#if saveError}
												<p class="text-xs text-red-400">{saveError}</p>
											{/if}
											<div class="flex gap-2">
												<button
													onclick={() => saveEdit(player.playerId)}
													disabled={saving}
													class="flex-1 py-1 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-900 rounded transition-colors"
												>
													{saving ? 'Saving…' : 'Save'}
												</button>
												<button
													onclick={cancelEdit}
													class="flex-1 py-1 text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
												>
													Cancel
												</button>
											</div>
											{#if player.yearsKeptOverridden || player.baseOverride !== null}
												<button
													onclick={() => resetPlayer(player.playerId)}
													disabled={saving}
													class="w-full py-1 text-xs text-slate-500 hover:text-red-400 disabled:opacity-40 transition-colors"
													title="Clear all overrides — use when player is dropped to the draft pool"
												>
													Reset to auto (player was dropped)
												</button>
											{/if}
										</div>
									{:else}
										<!-- Normal row -->
										{@const playerSubmitted = isCommish && mySelection?.playerIds.includes(player.playerId)}
										<div class="flex items-center gap-2">
											{#if isMyRoster}
												<input
													type="checkbox"
													bind:checked={checked[player.playerId]}
													disabled={!checked[player.playerId] && atKeeperLimit(roster)}
													class="accent-amber-400 w-3.5 h-3.5 shrink-0 rounded cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
												/>
											{:else if isCommish && playerSubmitted}
												<svg class="w-3.5 h-3.5 shrink-0 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
													<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
												</svg>
											{:else}
												<span class="w-3.5 h-3.5 shrink-0"></span>
											{/if}
											<span class="text-xs font-semibold {posColor(player.pos)} w-6 shrink-0">{player.pos}</span>
											<span class="text-sm {playerSubmitted ? 'text-white font-medium' : 'text-white'} truncate flex-1">{player.name}</span>
											<div class="flex items-center gap-2 shrink-0 text-right">
												<span class="text-xs text-slate-500" title="Base cost · years kept">
													{fmt(player.baseCost)} × {1 + (0.2 * (player.yearsKept + 1))}
												</span>
												<span class="text-sm font-semibold w-10 text-right {playerSubmitted ? 'text-green-400' : 'text-amber-400'}">
													{fmt(player.keeperCost)}
												</span>
												{#if isCommish}
													<button
														onclick={() => startEdit(player)}
														class="text-slate-600 hover:text-slate-300 transition-colors ml-0.5"
														title="Edit keeper data"
													>
														<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
															<path stroke-linecap="round" stroke-linejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 0l.172.172a2 2 0 010 2.828L12 16H9v-3z" />
														</svg>
													</button>
												{/if}
											</div>
										</div>
										<div class="flex justify-between ml-6 mt-0.5">
											{#if player.draftSeason && !isCommish}
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
									{/if}
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
						{:else if mySelection && isCommish}
							{@const submittedCost = roster.players
								.filter(p => mySelection.playerIds.includes(p.playerId))
								.reduce((s, p) => s + p.keeperCost, 0)}
							<div class="px-4 py-2.5 border-t border-navy-700 bg-navy-900 flex items-center justify-between">
								<span class="text-xs text-slate-500">
									{mySelection.playerIds.length} keeper{mySelection.playerIds.length !== 1 ? 's' : ''} · <span class="text-amber-400">${submittedCost}</span>
								</span>
								<span class="text-xs text-green-400 font-semibold">✓ Submitted</span>
							</div>
						{/if}
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- ── Import modal ── -->
{#if showImport}
	<div
		class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		onclick={(e) => { if (e.target === e.currentTarget) showImport = false; }}
		onkeydown={(e) => { if (e.key === 'Escape') showImport = false; }}
	>
		<div class="bg-navy-850 border border-navy-700 rounded-xl w-full max-w-lg p-6">
			<h2 class="text-lg font-bold text-white mb-1">Import pre-Sleeper keepers</h2>
			<p class="text-sm text-slate-400 mb-4">
				Paste a JSON array. Each entry needs a Sleeper <code class="text-amber-400">playerId</code>
				and optionally <code class="text-amber-400">baseCost</code> and
				<code class="text-amber-400">yearsKept</code>.
			</p>
			<pre class="text-xs text-slate-500 bg-slate-800 rounded-lg p-3 mb-4 overflow-x-auto">[
  {"{"}"playerId": "4034", "baseCost": 45, "yearsKept": 3{"}"},
  {"{"}"playerId": "5849", "baseCost": 5, "yearsKept": 7{"}"}
]</pre>
			<textarea
				bind:value={importJson}
				rows="8"
				placeholder="Paste JSON here…"
				class="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-2 text-sm text-slate-200
				       placeholder:text-navy-500 font-mono resize-none focus:outline-none focus:border-amber-400 transition-colors"
			></textarea>
			{#if importMsg}
				<p class="text-sm mt-2 {importMsg.startsWith('Error') ? 'text-red-400' : 'text-green-400'}">{importMsg}</p>
			{/if}
			<div class="flex gap-3 mt-4">
				<button
					onclick={runImport}
					disabled={importing || !importJson.trim()}
					class="flex-1 py-2 text-sm font-bold bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-900 rounded-xl transition-colors"
				>
					{importing ? 'Importing…' : 'Import'}
				</button>
				<button
					onclick={() => { showImport = false; importMsg = ''; }}
					class="flex-1 py-2 text-sm font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors"
				>
					Close
				</button>
			</div>
		</div>
	</div>
{/if}

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
