<script lang="ts">
	import type { PageData } from './$types';
	import type { SlimPlayer } from '$lib/types';
	import { onMount } from 'svelte';
	import FaabEasterEgg from '$lib/components/FaabEasterEgg.svelte';


	let { data } = $props<{ data: PageData }>();

	interface DraftPick {
		round: number;
		pickNo: number;
		slot: number;
		rosterId: number;
		team: string;
		playerId: string;
		playerName: string;
		pos: string;
		nflTeam: string;
		amount?: number;
	}

	interface DraftMeta {
		id: string;
		season: string;
		type: 'snake' | 'auction' | 'linear';
		status: string;
		rounds: number;
		teams: number;
		slotToRoster: Record<number, number>;
		rosterNames: Map<number, string>;
	}

	const names = $derived(
		new Map<number, string>(
			Object.entries(data.rosterInfo as Record<string, string>).map(([k, v]) => [Number(k), v])
		)
	);

	const draftsMeta = $derived<DraftMeta[]>(
		(data.completedDrafts ?? []).map((d: any) => ({
			id: d.draft_id,
			season: d.season,
			type: d.type,
			status: d.status,
			rounds: d.settings?.rounds ?? 0,
			teams: Object.keys(d.slot_to_roster_id ?? {}).length,
			slotToRoster: d.slot_to_roster_id ?? {},
			rosterNames: names,
		}))
	);

	let selectedIdx = $state(0);
	let loadingPicks = $state(true);
	let picksError = $state('');
	let currentPicks = $state<DraftPick[]>([]);

	let playersMap: Record<string, SlimPlayer> = {};

	async function loadPicks(meta: DraftMeta) {
		const draftId = meta.id;
		const leagueId = data.leagueId;
		loadingPicks = true;
		picksError = '';
		try {
			const res = await fetch(
				`/api/drafts?leagueId=${encodeURIComponent(leagueId)}&draftId=${encodeURIComponent(draftId)}`,
			);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const { picks: rawPicks } = await res.json();
			if (data.leagueId !== leagueId || draftsMeta[selectedIdx]?.id !== draftId) return;
			currentPicks = rawPicks.map((p: any) => {
				const player = playersMap[p.player_id];
				return {
					round: p.round,
					pickNo: p.pick_no,
					slot: p.draft_slot,
					rosterId: p.roster_id,
					team: meta.rosterNames.get(Number(p.roster_id)) ?? `Team ${p.roster_id}`,
					playerId: p.player_id,
					playerName: player?.name ?? p.metadata?.name ?? p.player_id,
					pos: player?.pos ?? p.metadata?.position ?? '?',
					nflTeam: player?.team ?? p.metadata?.team ?? 'FA',
					amount: p.metadata?.amount ? parseInt(p.metadata.amount, 10) : undefined,
				};
			});
		} catch (e: any) {
			if (data.leagueId !== leagueId || draftsMeta[selectedIdx]?.id !== draftId) return;
			picksError = e.message;
		} finally {
			if (data.leagueId !== leagueId || draftsMeta[selectedIdx]?.id !== draftId) return;
			loadingPicks = false;
		}
	}

	function selectDraft(idx: number) {
		selectedIdx = idx;
		currentPicks = [];
		const meta = draftsMeta[idx];
		if (meta) loadPicks(meta);
	}

	onMount(async () => {
		playersMap = await fetch('/api/players').then(r => r.ok ? r.json() : {});
		const meta = draftsMeta[0];
		if (meta) {
			await loadPicks(meta);
		} else {
			loadingPicks = false;
		}
	});

	const posColor: Record<string, string> = {
		QB: 'border-l-red-500',
		RB: 'border-l-green-500',
		WR: 'border-l-slate-400',
		TE: 'border-l-yellow-500',
		K: 'border-l-purple-500',
		DEF: 'border-l-orange-500'
	};
	function pc(pos: string) { return posColor[pos] ?? 'border-l-slate-600'; }

	const draft = $derived(draftsMeta[selectedIdx]);

	// grid[round-1][slot-1]; falls back to deriving team count from picks when
	// slot_to_roster_id was missing from the cached draft metadata.
	function picksGrid(meta: DraftMeta, picks: DraftPick[], teams: number): (DraftPick | null)[][] {
		const rounds = meta.rounds > 0 ? meta.rounds : Math.max(0, ...picks.map(p => p.round));
		const grid: (DraftPick | null)[][] = Array.from({ length: rounds }, () =>
			new Array(teams).fill(null)
		);
		for (const pick of picks) {
			const row = pick.round - 1;
			const col = pick.slot - 1;
			if (row >= 0 && row < rounds && col >= 0 && col < teams) {
				grid[row][col] = pick;
			}
		}
		return grid;
	}
</script>

<div>
	<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none mb-6">Drafts</h1>

	{#if draftsMeta.length === 0}
		{#if loadingPicks}
			<div class="space-y-3">
				{#each Array(3) as _}
					<div class="h-12 bg-navy-850 rounded-lg animate-pulse"></div>
				{/each}
			</div>
		{:else}
			<p class="text-navy-500">No completed drafts found.</p>
		{/if}
	{:else}
		{#if draftsMeta.length > 1}
			<div class="flex mb-6 border-b border-navy-700">
				{#each draftsMeta as d, i}
					<button
						onclick={() => selectDraft(i)}
						class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
						       {selectedIdx === i ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
					>
						{d.season}
					</button>
				{/each}
			</div>
		{/if}

		{#if draft}
			<div class="mb-3 flex items-center gap-3">
				<span class="text-navy-500 text-xs uppercase tracking-wider">{draft.season} · {draft.type} · {draft.rounds} rounds · {draft.teams > 0 ? draft.teams : new Set(currentPicks.map(p => p.slot)).size} teams</span>
				{#if loadingPicks}
					<span class="text-navy-500 text-xs">Loading picks…</span>
				{/if}
			</div>

			{#if picksError}
				<p class="text-red-400 text-sm mb-4">Failed to load picks: {picksError}</p>
			{:else if loadingPicks}
				<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
					{#each Array(6) as _}
						<div class="h-24 bg-navy-850 rounded-lg animate-pulse"></div>
					{/each}
				</div>
			{:else if draft.type === 'auction'}
				<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
					{#each [...draft.rosterNames.entries()].sort((a, b) => a[1].localeCompare(b[1])) as [rid, tname]}
						{@const teamPicks = currentPicks.filter((p) => p.rosterId === rid).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))}
						<div class="bg-navy-850 rounded-lg border border-navy-700 overflow-hidden">
							<div class="px-3 py-2 border-b border-navy-700 bg-navy-900">
								<p class="font-sport font-bold text-sm text-white uppercase tracking-wide">{tname}</p>
							</div>
							<div class="divide-y divide-navy-700/60">
								{#each teamPicks as pick}
									<div class="flex items-center gap-2 px-3 py-2 border-l-2 {pc(pick.pos)}">
										<span class="text-xs text-slate-500 w-6 text-right shrink-0">${pick.amount}</span>
										<span class="text-xs font-bold text-slate-400 w-6 shrink-0">{pick.pos}</span>
										<span class="text-sm text-slate-200 truncate">{pick.playerName}</span>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<!-- Snake / linear: round rows × team columns -->
				{@const effectiveSlotToRoster = Object.keys(draft.slotToRoster).length > 0
					? draft.slotToRoster
					: Object.fromEntries([...new Map(currentPicks.filter(p => p.round === 1).map(p => [p.slot, p.rosterId])).entries()])}
				{@const slots = Object.entries(effectiveSlotToRoster)
					.sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10))
					.map(([slot, rid]) => [Number(slot), Number(rid)] as [number, number])}
				{@const grid = picksGrid(draft, currentPicks, slots.length)}
				<div class="overflow-x-auto rounded-lg border border-navy-700">
					<table class="text-xs border-collapse w-max">
						<thead>
							<tr class="bg-navy-900">
								<th class="px-2 py-2 text-navy-500 text-left font-semibold w-12 border-b border-navy-700 uppercase tracking-wider text-[10px]">Rd<FaabEasterEgg eggId="6" leagueId={data.leagueId} loggedIn={!!data.user} /></th>
								{#each slots as [, rid]}
									<th class="px-2 py-2 text-navy-500 font-semibold border-b border-navy-700 min-w-[120px] max-w-[150px] uppercase tracking-wider text-[10px]">
										<span class="truncate block">{draft.rosterNames.get(rid) ?? `T${rid}`}</span>
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each grid as row, ri}
								<tr class="{ri % 2 !== 0 ? 'bg-navy-875' : ''}">
									<td class="px-2 py-1.5 text-navy-500 font-mono border-r border-navy-700">{ri + 1}</td>
									{#each row as pick}
										{#if pick}
											<td class="px-2 py-1.5 border-l-2 {pc(pick.pos)}">
												<p class="text-slate-200 truncate font-medium">{pick.playerName}</p>
												<p class="text-navy-500">{pick.pos} · {pick.nflTeam}</p>
											</td>
										{:else}
											<td class="px-2 py-1.5 text-navy-700">—</td>
										{/if}
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{/if}
	{/if}
</div>
