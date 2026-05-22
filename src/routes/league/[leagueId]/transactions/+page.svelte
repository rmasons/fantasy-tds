<script lang="ts">
	import type { LayoutData } from '../$types';
	import type { SleeperLeagueUser, SleeperRoster } from '$lib/types';
	import type { SlimPlayer } from '$lib/types';
	import { onMount } from 'svelte';

	let { data } = $props<{ data: LayoutData }>();

	type TxType = 'all' | 'trade' | 'waiver' | 'free_agent';

	interface TxMove {
		type: 'add' | 'drop' | 'pick';
		player?: string;
		round?: number;
		season?: string;
		rosterId: number;
	}

	interface Transaction {
		id: string;
		type: 'trade' | 'waiver' | 'free_agent';
		date: string;
		rosterIds: number[];
		moves: TxMove[];
	}

	let transactions = $state<Transaction[]>([]);
	let filter = $state<TxType>('all');
	let loading = $state(true);
	let error = $state('');

	let rosterTeamMap = new Map<number, string>();
	let players: Record<string, SlimPlayer> = {};

	onMount(async () => {
		try {
			const [rostersRes, usersRes, leagueRes, nflRes, playersRes] = await Promise.all([
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/rosters`),
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/users`),
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}`),
				fetch('https://api.sleeper.app/v1/state/nfl'),
				fetch('/api/players')
			]);
			const [rosters, users, league, nfl, playersData]: [SleeperRoster[], SleeperLeagueUser[], any, any, Record<string, SlimPlayer>] =
				await Promise.all([rostersRes.json(), usersRes.json(), leagueRes.json(), nflRes.json(), playersRes.json()]);

			players = playersData;
			const userMap = new Map<string, SleeperLeagueUser>(users.map((u) => [u.user_id, u]));
			for (const r of rosters) {
				const u = userMap.get(r.owner_id);
				rosterTeamMap.set(r.roster_id, u?.metadata?.team_name ?? u?.display_name ?? `Team ${r.roster_id}`);
			}

			let week = nfl.season_type === 'regular' ? nfl.week : nfl.season_type === 'post' ? 18 : 1;
			week = Math.max(week, 1);

			// Fetch all weeks in parallel
			const weekNums = Array.from({ length: week }, (_, i) => i + 1);
			const txResponses = await Promise.all(
				weekNums.map((w) => fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/transactions/${w}`))
			);
			const txWeeks: any[][] = await Promise.all(txResponses.map((r) => r.json()));

			const raw = txWeeks.flat().filter((t) => t.status === 'complete');
			raw.sort((a, b) => b.status_updated - a.status_updated);

			transactions = raw.map((t) => {
				const moves: TxMove[] = [];

				for (const [pid, rid] of Object.entries(t.adds ?? {})) {
					moves.push({ type: 'add', player: pid, rosterId: rid as number });
				}
				for (const [pid, rid] of Object.entries(t.drops ?? {})) {
					moves.push({ type: 'drop', player: pid, rosterId: rid as number });
				}
				for (const pick of t.draft_picks ?? []) {
					moves.push({ type: 'pick', round: pick.round, season: pick.season, rosterId: pick.owner_id });
				}

				return {
					id: t.transaction_id,
					type: t.type,
					date: formatDate(t.status_updated),
					rosterIds: t.roster_ids as number[],
					moves
				};
			});
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	});

	function formatDate(ts: number) {
		return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function playerName(id: string) {
		return players[id]?.name ?? id;
	}
	function playerPos(id: string) {
		return players[id]?.pos ?? '?';
	}

	const typeLabel: Record<string, string> = { trade: 'Trade', waiver: 'Waiver', free_agent: 'Free Agent' };
	const typeBadge: Record<string, string> = {
		trade: 'bg-purple-900/60 text-purple-300',
		waiver: 'bg-blue-900/60 text-blue-300',
		free_agent: 'bg-green-900/60 text-green-300'
	};

	const filtered = $derived(filter === 'all' ? transactions : transactions.filter((t) => t.type === filter));
</script>

<div>
	<div class="flex items-center justify-between mb-6 flex-wrap gap-3">
		<h1 class="text-2xl font-bold">Transactions</h1>

		<div class="flex gap-1 bg-gray-900 rounded-xl p-1">
			{#each (['all', 'trade', 'waiver', 'free_agent'] as TxType[]) as f}
				<button
					onclick={() => (filter = f)}
					class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
					       {filter === f ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}"
				>
					{f === 'all' ? 'All' : f === 'free_agent' ? 'Free Agent' : f.charAt(0).toUpperCase() + f.slice(1)}
				</button>
			{/each}
		</div>
	</div>

	{#if loading}
		<div class="space-y-3">
			{#each Array(8) as _}
				<div class="h-16 bg-gray-800 rounded-xl animate-pulse"></div>
			{/each}
		</div>
	{:else if error}
		<p class="text-red-400">Failed to load transactions: {error}</p>
	{:else if filtered.length === 0}
		<p class="text-gray-400">No transactions found.</p>
	{:else}
		<div class="space-y-3">
			{#each filtered as tx (tx.id)}
				<div class="bg-gray-900 rounded-xl border border-gray-800 px-4 py-3">
					<div class="flex items-center gap-2 mb-2">
						<span class="text-xs px-2 py-0.5 rounded-full font-semibold {typeBadge[tx.type] ?? 'bg-gray-700 text-gray-300'}">
							{typeLabel[tx.type] ?? tx.type}
						</span>
						<span class="text-xs text-gray-500">{tx.date}</span>
						{#if tx.type === 'trade'}
							<span class="text-xs text-gray-500">·</span>
							{#each tx.rosterIds as rid, i}
								<span class="text-xs text-gray-400">{rosterTeamMap.get(rid) ?? `Team ${rid}`}{i < tx.rosterIds.length - 1 ? ' ↔ ' : ''}</span>
							{/each}
						{/if}
					</div>

					<div class="space-y-1">
						{#each tx.moves as move}
							{#if move.type === 'add' && move.player}
								<div class="flex items-center gap-2 text-sm">
									<span class="text-green-500 text-xs w-3">+</span>
									<span class="text-xs text-gray-600 w-5">{playerPos(move.player)}</span>
									<span class="text-gray-200">{playerName(move.player)}</span>
									{#if tx.type !== 'trade'}
										<span class="text-xs text-gray-500 ml-auto">{rosterTeamMap.get(move.rosterId)}</span>
									{/if}
								</div>
							{:else if move.type === 'drop' && move.player}
								<div class="flex items-center gap-2 text-sm">
									<span class="text-red-500 text-xs w-3">−</span>
									<span class="text-xs text-gray-600 w-5">{playerPos(move.player)}</span>
									<span class="text-gray-400">{playerName(move.player)}</span>
									{#if tx.type !== 'trade'}
										<span class="text-xs text-gray-500 ml-auto">{rosterTeamMap.get(move.rosterId)}</span>
									{/if}
								</div>
							{:else if move.type === 'pick'}
								<div class="flex items-center gap-2 text-sm">
									<span class="text-yellow-500 text-xs w-3">↑</span>
									<span class="text-gray-300">{move.season} Round {move.round} pick</span>
									<span class="text-xs text-gray-500 ml-auto">→ {rosterTeamMap.get(move.rosterId)}</span>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
