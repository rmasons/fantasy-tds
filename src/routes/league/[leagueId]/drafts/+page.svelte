<script lang="ts">
	import type { LayoutData } from '../$types';
	import type { SlimPlayer } from '$lib/types';
	import { fetchLeagueCore, fetchDrafts as fetchLeagueDrafts, fetchDraftPicks, buildRosterInfoMap } from '$lib/sleeper';

	let { data } = $props<{ data: LayoutData }>();

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
		amount?: number; // auction
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

	let draftsMeta = $state<DraftMeta[]>([]);
	let selectedIdx = $state(0);
	let loading = $state(true);
	let loadingPicks = $state(false);
	let error = $state('');
	let picksError = $state('');
	let currentPicks = $state<DraftPick[]>([]);

	// Plain variable — not reactive. Set before draftsMeta is populated so it's
	// always ready when the picks effect runs.
	let playersMap: Record<string, SlimPlayer> = {};

	// ── Effect 1: load draft list + player lookup on league change ────────────
	$effect(() => {
		const leagueId = data.leagueId;
		draftsMeta = [];
		selectedIdx = 0;
		currentPicks = [];
		loading = true;
		error = '';
		playersMap = {};

		(async () => {
			try {
				const [{ rosters, users }, draftList, rawPlayers] = await Promise.all([
					fetchLeagueCore(leagueId),
					fetchLeagueDrafts(leagueId),
					fetch('/api/players').then(r => r.ok ? r.json() : {}),
				]);

				if (data.leagueId !== leagueId) return;

				playersMap = rawPlayers;

				const rosterInfo = buildRosterInfoMap(rosters, users);
				const names = new Map<number, string>();
				for (const [id, info] of rosterInfo) names.set(id, info.teamName);

				draftsMeta = draftList
					.filter((d: any) => d.status === 'complete')
					.sort((a: any, b: any) => parseInt(b.season, 10) - parseInt(a.season, 10))
					.map((d: any) => ({
						id: d.draft_id,
						season: d.season,
						type: d.type,
						status: d.status,
						rounds: d.settings?.rounds ?? 0,
						teams: Object.keys(d.slot_to_roster_id ?? {}).length,
						slotToRoster: d.slot_to_roster_id ?? {},
						rosterNames: names,
					}));
			} catch (e: any) {
				if (data.leagueId !== leagueId) return;
				error = e.message;
			} finally {
				if (data.leagueId !== leagueId) return;
				loading = false;
			}
		})();
	});

	// ── Effect 2: load picks for the selected draft ───────────────────────────
	$effect(() => {
		const meta = draftsMeta[selectedIdx];
		if (!meta) { currentPicks = []; return; }

		const draftId = meta.id;
		loadingPicks = true;
		picksError = '';

		(async () => {
			try {
				const rawPicks = await fetchDraftPicks(draftId);
				if (draftsMeta[selectedIdx]?.id !== draftId) return;

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
				if (draftsMeta[selectedIdx]?.id !== draftId) return;
				picksError = e.message;
			} finally {
				if (draftsMeta[selectedIdx]?.id !== draftId) return;
				loadingPicks = false;
			}
		})();
	});

	const posColor: Record<string, string> = {
		QB: 'border-l-red-500',
		RB: 'border-l-green-500',
		WR: 'border-l-blue-500',
		TE: 'border-l-yellow-500',
		K: 'border-l-purple-500',
		DEF: 'border-l-orange-500'
	};
	function pc(pos: string) { return posColor[pos] ?? 'border-l-slate-600'; }

	const draft = $derived(draftsMeta[selectedIdx]);

	function picksGrid(meta: DraftMeta, picks: DraftPick[]): (DraftPick | null)[][] {
		const grid: (DraftPick | null)[][] = Array.from({ length: meta.rounds }, () =>
			new Array(meta.teams).fill(null)
		);
		for (const pick of picks) {
			const row = pick.round - 1;
			const col = pick.slot - 1;
			if (row >= 0 && row < meta.rounds && col >= 0 && col < meta.teams) {
				grid[row][col] = pick;
			}
		}
		return grid;
	}
</script>

<div>
	<h1 class="text-2xl font-bold mb-6">Drafts</h1>

	{#if loading}
		<div class="space-y-3">
			{#each Array(3) as _}
				<div class="h-12 bg-slate-800 rounded-xl animate-pulse"></div>
			{/each}
		</div>
	{:else if error}
		<p class="text-red-400">Failed to load drafts: {error}</p>
	{:else if draftsMeta.length === 0}
		<p class="text-slate-400">No completed drafts found.</p>
	{:else}
		<!-- Draft selector tabs -->
		{#if draftsMeta.length > 1}
			<div class="flex gap-1 bg-slate-900 rounded-xl p-1 mb-6 w-fit">
				{#each draftsMeta as d, i}
					<button
						onclick={() => (selectedIdx = i)}
						class="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
						       {selectedIdx === i ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}"
					>
						{d.season}
					</button>
				{/each}
			</div>
		{/if}

		{#if draft}
			<div class="mb-3 flex items-center gap-3">
				<span class="text-slate-400 text-sm">{draft.season} · {draft.type} · {draft.rounds} rounds · {draft.teams} teams</span>
				{#if loadingPicks}
					<span class="text-slate-600 text-xs">Loading picks…</span>
				{/if}
			</div>

			{#if picksError}
				<p class="text-red-400 text-sm mb-4">Failed to load picks: {picksError}</p>
			{:else if loadingPicks}
				<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
					{#each Array(6) as _}
						<div class="h-24 bg-slate-800 rounded-xl animate-pulse"></div>
					{/each}
				</div>
			{:else if draft.type === 'auction'}
				<!-- Auction: each team's picks sorted by amount -->
				<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
					{#each [...draft.rosterNames.entries()].sort((a, b) => a[1].localeCompare(b[1])) as [rid, tname]}
						{@const teamPicks = currentPicks.filter((p) => p.rosterId === rid).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))}
						<div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
							<div class="px-3 py-2 border-b border-slate-800 bg-slate-800/40">
								<p class="font-medium text-sm text-white">{tname}</p>
							</div>
							<div class="divide-y divide-slate-800/60">
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
				<!-- Snake / linear: round × pick grid -->
				{@const grid = picksGrid(draft, currentPicks)}
				{@const slots = Object.entries(draft.slotToRoster)
					.sort((a, b) => parseInt(a[0], 10) - parseInt(b[0], 10))
					.map(([slot, rid]) => [Number(slot), Number(rid)] as [number, number])}
				<div class="overflow-x-auto rounded-xl border border-slate-800">
					<table class="text-xs border-collapse w-max">
						<thead>
							<tr class="bg-slate-900">
								<th class="px-2 py-2 text-slate-500 text-left font-normal w-12 border-b border-slate-800">Rd</th>
								{#each slots as [, rid]}
									<th class="px-2 py-2 text-slate-400 font-medium border-b border-slate-800 min-w-[120px] max-w-[150px]">
										<span class="truncate block">{draft.rosterNames.get(rid) ?? `T${rid}`}</span>
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each grid as row, ri}
								<tr class="{ri % 2 === 0 ? 'bg-slate-950' : 'bg-slate-900/50'}">
									<td class="px-2 py-1.5 text-slate-600 font-mono border-r border-slate-800">{ri + 1}</td>
									{#each row as pick}
										{#if pick}
											<td class="px-2 py-1.5 border-l-2 {pc(pick.pos)}">
												<p class="text-slate-200 truncate font-medium">{pick.playerName}</p>
												<p class="text-slate-500">{pick.pos} · {pick.nflTeam}</p>
											</td>
										{:else}
											<td class="px-2 py-1.5 text-slate-700">—</td>
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
