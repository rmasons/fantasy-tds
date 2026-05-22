<script lang="ts">
	import type { LayoutData } from '../$types';
	import type { SleeperRoster, SleeperLeagueUser } from '$lib/types';
	import type { SlimPlayer } from '$lib/types';
	import { onMount } from 'svelte';

	let { data } = $props<{ data: LayoutData }>();

	interface DraftPick {
		round: number;
		pickNo: number;
		slot: number;
		rosterId: number;
		originalRosterId: number;
		team: string;
		playerId: string;
		playerName: string;
		pos: string;
		nflTeam: string;
		amount?: number; // auction
	}

	interface Draft {
		id: string;
		season: string;
		type: 'snake' | 'auction' | 'linear';
		status: string;
		rounds: number;
		teams: number;
		picks: DraftPick[];
		slotToRoster: Record<number, number>;
		rosterNames: Map<number, string>;
	}

	let drafts = $state<Draft[]>([]);
	let selectedDraft = $state(0);
	let loading = $state(true);
	let error = $state('');

	let rosterNameMap = new Map<number, string>();

	onMount(async () => {
		try {
			const [rostersRes, usersRes, draftsRes, playersRes] = await Promise.all([
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/rosters`),
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/users`),
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/drafts`),
				fetch('/api/players')
			]);
			const [rosters, users, draftList, players]: [SleeperRoster[], SleeperLeagueUser[], any[], Record<string, SlimPlayer>] =
				await Promise.all([rostersRes.json(), usersRes.json(), draftsRes.json(), playersRes.json()]);

			const userMap = new Map<string, SleeperLeagueUser>(users.map((u) => [u.user_id, u]));
			for (const r of rosters) {
				const u = userMap.get(r.owner_id);
				rosterNameMap.set(r.roster_id, u?.metadata?.team_name ?? u?.display_name ?? `Team ${r.roster_id}`);
			}

			const completedDrafts = draftList.filter((d) => d.status === 'complete');
			completedDrafts.sort((a, b) => parseInt(b.season) - parseInt(a.season));

			drafts = await Promise.all(
				completedDrafts.map(async (d) => {
					const picksRes = await fetch(`https://api.sleeper.app/v1/draft/${d.draft_id}/picks`);
					const rawPicks: any[] = await picksRes.json();

					const slotToRoster: Record<number, number> = d.slot_to_roster_id ?? {};
					const rosterToSlot = new Map<number, number>(
						Object.entries(slotToRoster).map(([slot, rid]) => [rid as number, parseInt(slot)])
					);

					const picks: DraftPick[] = rawPicks.map((p) => {
						const player = players[p.player_id];
						return {
							round: p.round,
							pickNo: p.pick_no,
							slot: p.draft_slot,
							rosterId: p.roster_id,
							originalRosterId: p.roster_id,
							team: rosterNameMap.get(p.roster_id) ?? `Team ${p.roster_id}`,
							playerId: p.player_id,
							playerName: player?.name ?? p.metadata?.name ?? p.player_id,
							pos: player?.pos ?? p.metadata?.position ?? '?',
							nflTeam: player?.team ?? p.metadata?.team ?? 'FA',
							amount: p.metadata?.amount ? parseInt(p.metadata.amount) : undefined
						};
					});

					return {
						id: d.draft_id,
						season: d.season,
						type: d.type,
						status: d.status,
						rounds: d.settings.rounds,
						teams: Object.keys(slotToRoster).length,
						picks,
						slotToRoster,
						rosterNames: rosterNameMap
					} satisfies Draft;
				})
			);
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	});

	const posColor: Record<string, string> = {
		QB: 'border-l-red-500',
		RB: 'border-l-green-500',
		WR: 'border-l-blue-500',
		TE: 'border-l-yellow-500',
		K: 'border-l-purple-500',
		DEF: 'border-l-orange-500'
	};
	function pc(pos: string) { return posColor[pos] ?? 'border-l-gray-600'; }

	const draft = $derived(drafts[selectedDraft]);

	function picksGrid(d: Draft): (DraftPick | null)[][] {
		const grid: (DraftPick | null)[][] = Array.from({ length: d.rounds }, () =>
			new Array(d.teams).fill(null)
		);
		for (const pick of d.picks) {
			const row = pick.round - 1;
			const col = pick.slot - 1;
			if (row >= 0 && row < d.rounds && col >= 0 && col < d.teams) {
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
				<div class="h-12 bg-gray-800 rounded-xl animate-pulse"></div>
			{/each}
		</div>
	{:else if error}
		<p class="text-red-400">Failed to load drafts: {error}</p>
	{:else if drafts.length === 0}
		<p class="text-gray-400">No completed drafts found.</p>
	{:else}
		<!-- Draft selector tabs -->
		{#if drafts.length > 1}
			<div class="flex gap-1 bg-gray-900 rounded-xl p-1 mb-6 w-fit">
				{#each drafts as d, i}
					<button
						onclick={() => (selectedDraft = i)}
						class="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
						       {selectedDraft === i ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}"
					>
						{d.season}
					</button>
				{/each}
			</div>
		{/if}

		{#if draft}
			<div class="mb-3 flex items-center gap-3">
				<span class="text-gray-400 text-sm">{draft.season} · {draft.type} · {draft.rounds} rounds · {draft.teams} teams</span>
			</div>

			{#if draft.type === 'auction'}
				<!-- Auction: show each team's picks sorted by amount -->
				<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
					{#each [...draft.rosterNames.entries()].sort((a, b) => a[1].localeCompare(b[1])) as [rid, tname]}
						{@const teamPicks = draft.picks.filter((p) => p.rosterId === rid).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))}
						<div class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
							<div class="px-3 py-2 border-b border-gray-800 bg-gray-800/40">
								<p class="font-medium text-sm text-white">{tname}</p>
							</div>
							<div class="divide-y divide-gray-800/60">
								{#each teamPicks as pick}
									<div class="flex items-center gap-2 px-3 py-2 border-l-2 {pc(pick.pos)}">
										<span class="text-xs text-gray-500 w-6 text-right shrink-0">${pick.amount}</span>
										<span class="text-xs font-bold text-gray-400 w-6 shrink-0">{pick.pos}</span>
										<span class="text-sm text-gray-200 truncate">{pick.playerName}</span>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{:else}
				<!-- Snake / linear: round × pick grid -->
				{@const grid = picksGrid(draft)}
				{@const slots = Object.entries(draft.slotToRoster)
					.sort((a, b) => parseInt(a[0]) - parseInt(b[0]))}
				<div class="overflow-x-auto rounded-xl border border-gray-800">
					<table class="text-xs border-collapse w-max">
						<thead>
							<tr class="bg-gray-900">
								<th class="px-2 py-2 text-gray-500 text-left font-normal w-12 border-b border-gray-800">Rd</th>
								{#each slots as [slot, rid]}
									<th class="px-2 py-2 text-gray-400 font-medium border-b border-gray-800 min-w-[120px] max-w-[150px]">
										<span class="truncate block">{rosterNameMap.get(rid as number) ?? `T${rid}`}</span>
									</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each grid as row, ri}
								<tr class="{ri % 2 === 0 ? 'bg-gray-950' : 'bg-gray-900/50'}">
									<td class="px-2 py-1.5 text-gray-600 font-mono border-r border-gray-800">{ri + 1}</td>
									{#each row as pick}
										{#if pick}
											<td class="px-2 py-1.5 border-l-2 {pc(pick.pos)}">
												<p class="text-gray-200 truncate font-medium">{pick.playerName}</p>
												<p class="text-gray-500">{pick.pos} · {pick.nflTeam}</p>
											</td>
										{:else}
											<td class="px-2 py-1.5 text-gray-700">—</td>
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
