<script lang="ts">
	import type { LayoutData } from '../$types';
	import type { SlimPlayer } from '$lib/types';
	import { fetchLeagueCore, fetchNflState, fetchTransactions as fetchWeekTransactions, buildRosterInfoMap, type RosterInfo } from '$lib/sleeper';

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

	let rosterInfoMap = $state(new Map<number, RosterInfo>());
	let players = $state<Record<string, SlimPlayer>>({});

	$effect(() => {
		const leagueId = data.leagueId;
		transactions = [];
		loading = true;
		error = '';
		rosterInfoMap = new Map();
		players = {};

		(async () => {
			try {
				const [{ league, rosters, users }, nfl, playersData] = await Promise.all([
					fetchLeagueCore(leagueId),
					fetchNflState(),
					fetch('/api/players').then((r) => r.json()) as Promise<Record<string, SlimPlayer>>,
				]);

				if (data.leagueId !== leagueId) return;

				players = playersData;
				rosterInfoMap = buildRosterInfoMap(rosters, users);

				let week = nfl.season_type === 'regular' ? nfl.week : nfl.season_type === 'post' ? 18 : 1;
				week = Math.max(week, 1);

				const weekNums = Array.from({ length: week }, (_, i) => i + 1);
				const txWeeks: any[][] = await Promise.all(
					weekNums.map((w) => fetchWeekTransactions(leagueId, w))
				);

				if (data.leagueId !== leagueId) return;

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
				if (data.leagueId !== leagueId) return;
				error = e.message;
			} finally {
				if (data.leagueId !== leagueId) return;
				loading = false;
			}
		})();
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

		<div class="flex gap-1 bg-slate-900 rounded-xl p-1">
			{#each (['all', 'trade', 'waiver', 'free_agent'] as TxType[]) as f}
				<button
					onclick={() => (filter = f)}
					class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
					       {filter === f ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}"
				>
					{f === 'all' ? 'All' : f === 'free_agent' ? 'Free Agent' : f.charAt(0).toUpperCase() + f.slice(1)}
				</button>
			{/each}
		</div>
	</div>

	{#if loading}
		<div class="space-y-3">
			{#each Array(8) as _}
				<div class="h-16 bg-slate-800 rounded-xl animate-pulse"></div>
			{/each}
		</div>
	{:else if error}
		<p class="text-red-400">Failed to load transactions: {error}</p>
	{:else if filtered.length === 0}
		<p class="text-slate-400">No transactions found.</p>
	{:else}
		<div class="space-y-3">
			{#each filtered as tx (tx.id)}
				<div class="bg-slate-900 rounded-xl border border-slate-800 px-4 py-3">
					<div class="flex items-center gap-2 mb-2">
						<span class="text-xs px-2 py-0.5 rounded-full font-semibold {typeBadge[tx.type] ?? 'bg-slate-700 text-slate-300'}">
							{typeLabel[tx.type] ?? tx.type}
						</span>
						<span class="text-xs text-slate-500">{tx.date}</span>
						{#if tx.type === 'trade'}
							<span class="text-xs text-slate-500">·</span>
							{#each tx.rosterIds as rid, i}
								<span class="text-xs text-slate-400">{rosterInfoMap.get(rid)?.teamName ?? `Team ${rid}`}{i < tx.rosterIds.length - 1 ? ' ↔ ' : ''}</span>
							{/each}
						{/if}
					</div>

					<div class="space-y-1">
						{#each tx.moves as move}
							{#if move.type === 'add' && move.player}
								<div class="flex items-center gap-2 text-sm">
									<span class="text-green-500 text-xs w-3">+</span>
									<span class="text-xs text-slate-600 w-5">{playerPos(move.player)}</span>
									<span class="text-slate-200">{playerName(move.player)}</span>
									{#if tx.type !== 'trade'}
										<span class="text-xs text-slate-500 ml-auto">{rosterInfoMap.get(move.rosterId)?.teamName}</span>
									{/if}
								</div>
							{:else if move.type === 'drop' && move.player}
								<div class="flex items-center gap-2 text-sm">
									<span class="text-red-500 text-xs w-3">−</span>
									<span class="text-xs text-slate-600 w-5">{playerPos(move.player)}</span>
									<span class="text-slate-400">{playerName(move.player)}</span>
									{#if tx.type !== 'trade'}
										<span class="text-xs text-slate-500 ml-auto">{rosterInfoMap.get(move.rosterId)?.teamName}</span>
									{/if}
								</div>
							{:else if move.type === 'pick'}
								<div class="flex items-center gap-2 text-sm">
									<span class="text-yellow-500 text-xs w-3">↑</span>
									<span class="text-slate-300">{move.season} Round {move.round} pick</span>
									<span class="text-xs text-slate-500 ml-auto">→ {rosterInfoMap.get(move.rosterId)?.teamName}</span>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
