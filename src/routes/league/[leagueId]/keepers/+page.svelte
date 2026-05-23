<script lang="ts">
	import type { PageData } from './$types';
	import type { KeeperPlayerData, KeeperRosterData } from '$lib/server/keepers';
	import { onMount } from 'svelte';

	let { data } = $props<{ data: PageData }>();

	// ── State ──────────────────────────────────────────────────────────────
	let rosters = $state<KeeperRosterData[]>([]);
	let planningYear = $state('');
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

	// Draft cache refresh
	let refreshing = $state(false);

	// ── Load data ──────────────────────────────────────────────────────────
	async function load() {
		loading = true;
		fetchError = '';
		try {
			const res = await fetch(`/api/keepers?leagueId=${encodeURIComponent(data.leagueId)}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const d = await res.json();
			rosters = d.rosters;
			planningYear = d.planningYear;
		} catch (e: any) {
			fetchError = e.message;
		} finally {
			loading = false;
		}
	}

	onMount(load);

	// ── Derived totals ─────────────────────────────────────────────────────
	function rosterTotal(roster: KeeperRosterData): number {
		return roster.players
			.filter(p => checked[p.playerId] && p.keeperCost !== null)
			.reduce((s, p) => s + p.keeperCost!, 0);
	}

	function rosterKeeperCount(roster: KeeperRosterData): number {
		return roster.players.filter(p => checked[p.playerId]).length;
	}

	const grandTotal = $derived(
		rosters.reduce((s, r) => s + rosterTotal(r), 0)
	);

	const grandCount = $derived(
		Object.values(checked).filter(Boolean).length
	);

	// ── Cost helpers ───────────────────────────────────────────────────────
	function fmt(n: number | null): string {
		if (n === null) return '—';
		return `$${n}`;
	}

	function posColor(pos: string): string {
		return (
			pos === 'QB'  ? 'text-red-400'    :
			pos === 'RB'  ? 'text-green-400'  :
			pos === 'WR'  ? 'text-blue-400'   :
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

	// ── Draft cache refresh ────────────────────────────────────────────────
	async function refreshDraftCache() {
		refreshing = true;
		try {
			await fetch(
				`/api/keepers?leagueId=${encodeURIComponent(data.leagueId)}&action=invalidate-cache`,
				{ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
			);
			await load();
		} finally {
			refreshing = false;
		}
	}
</script>

<div>
	<!-- ── Header ── -->
	<div class="flex items-start justify-between mb-6 flex-wrap gap-3">
		<div>
			<h1 class="text-2xl font-extrabold text-white">
				Keepers
				{#if planningYear}<span class="text-slate-500 font-normal text-lg ml-2">{planningYear}</span>{/if}
			</h1>
			{#if !loading && !fetchError}
				<p class="text-sm text-slate-500 mt-0.5">
					{grandCount} selected · <span class="text-amber-400 font-semibold">${grandTotal} FAAB</span>
				</p>
			{/if}
		</div>

		<div class="flex items-center gap-2 flex-wrap">
			{#if data.user}
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

	<!-- ── Loading / error ── -->
	{#if loading}
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
			{#each Array(6) as _}
				<div class="h-64 bg-slate-800 rounded-xl animate-pulse"></div>
			{/each}
		</div>
	{:else if fetchError}
		<div class="bg-slate-900 rounded-xl border border-slate-800 p-6 text-center">
			<p class="text-slate-400 mb-1">Failed to load keeper data.</p>
			<p class="text-slate-600 text-sm">{fetchError}</p>
			<button onclick={load} class="mt-3 px-4 py-1.5 text-sm bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-200 transition-colors">
				Retry
			</button>
		</div>
	{:else}
		<!-- ── Roster grid ── -->
		<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
			{#each rosters as roster}
				{@const total = rosterTotal(roster)}
				{@const count = rosterKeeperCount(roster)}
				<div class="bg-slate-900 rounded-xl border border-slate-800/60 overflow-hidden flex flex-col">
					<!-- Roster header -->
					<div class="flex items-center gap-2.5 px-4 py-3 border-b border-slate-800/60 bg-slate-900/80">
						{#if roster.ownerAvatar}
							<img
								src="https://sleepercdn.com/avatars/thumbs/{roster.ownerAvatar}"
								alt=""
								class="w-7 h-7 rounded-full object-cover ring-1 ring-slate-700 shrink-0"
							/>
						{:else}
							<div class="w-7 h-7 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-xs shrink-0">
								🏈
							</div>
						{/if}
						<span class="font-semibold text-white text-sm truncate flex-1">{roster.ownerName}</span>
						{#if count > 0}
							<span class="text-xs font-bold text-amber-400 shrink-0">${total}</span>
						{/if}
					</div>

					<!-- Player rows -->
					<div class="flex-1 divide-y divide-slate-800/40">
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
									</div>
								{:else}
									<!-- Normal row -->
									<div class="flex items-center gap-2">
										<input
											type="checkbox"
											bind:checked={checked[player.playerId]}
											class="accent-amber-400 w-3.5 h-3.5 shrink-0 rounded cursor-pointer"
										/>
										<span class="text-xs font-semibold {posColor(player.pos)} w-6 shrink-0">{player.pos}</span>
										<span class="text-sm text-white truncate flex-1">{player.name}</span>
										<!-- Cost info -->
										<div class="flex items-center gap-2 shrink-0 text-right">
											{#if player.baseCost === null}
												<span class="text-xs text-slate-600" title="Base cost unknown — set via commissioner edit">?</span>
											{:else}
												<span class="text-xs text-slate-500" title="Base cost · years kept">
													{fmt(player.baseCost)}×{player.yearsKept}
												</span>
											{/if}
											<span class="text-sm font-semibold w-10 text-right {player.keeperCost !== null ? 'text-amber-400' : 'text-slate-600'}">
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
									<!-- Subtle source hint for known items -->
									{#if player.draftSeason && !isCommish}
										<p class="text-xs text-slate-700 ml-6 mt-0.5 leading-none">
											R{player.draftRound} · {player.draftSeason}
											{#if player.yearsKeptOverridden}<span class="text-amber-900"> · override</span>{/if}
										</p>
									{/if}
								{/if}
							</div>
						{/each}
					</div>

					<!-- Roster footer total -->
					{#if count > 0}
						<div class="px-4 py-2.5 border-t border-slate-800/60 bg-slate-900/60 flex items-center justify-between">
							<span class="text-xs text-slate-500">{count} keeper{count !== 1 ? 's' : ''}</span>
							<span class="text-sm font-bold text-amber-400">${total} FAAB</span>
						</div>
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
		<div class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl p-6">
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
				class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200
				       placeholder:text-slate-600 font-mono resize-none focus:outline-none focus:border-amber-400 transition-colors"
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
