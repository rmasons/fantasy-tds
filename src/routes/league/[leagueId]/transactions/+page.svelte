<script lang="ts">
	import type { LayoutData } from '../$types';
	import type { SlimPlayer } from '$lib/types';
	import { fetchLeagueCore, fetchNflState, fetchTransactions as fetchWeekTransactions, buildRosterInfoMap, fetchDisplayNameOverrides, type RosterInfo } from '$lib/sleeper';

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
				const overrides = await fetchDisplayNameOverrides(users.map(u => u.user_id));
				rosterInfoMap = buildRosterInfoMap(rosters, users, overrides);

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
		waiver: 'bg-slate-800 text-slate-300',
		free_agent: 'bg-green-900/60 text-green-300'
	};

	const filtered = $derived(filter === 'all' ? transactions : transactions.filter((t) => t.type === filter));

	const counts = $derived({
		all: transactions.length,
		trade: transactions.filter(t => t.type === 'trade').length,
		waiver: transactions.filter(t => t.type === 'waiver').length,
		free_agent: transactions.filter(t => t.type === 'free_agent').length,
	});

	function tradeSides(tx: Transaction) {
		return tx.rosterIds.map(rid => ({
			rid,
			team: rosterInfoMap.get(rid),
			players: tx.moves.filter(m => m.type === 'add' && m.rosterId === rid),
			picks: tx.moves.filter(m => m.type === 'pick' && m.rosterId === rid),
		}));
	}
</script>

<div>
	<div class="flex items-start justify-between mb-6 flex-wrap gap-3">
		<div>
			<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">Transactions</h1>
		</div>
	</div>

	<div class="flex mb-6 border-b border-navy-700">
		{#each (['all', 'trade', 'waiver', 'free_agent'] as TxType[]) as f}
			<button
				onclick={() => (filter = f)}
				class="flex items-center gap-1.5 px-4 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
				       {filter === f ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
			>
				{f === 'all' ? 'All' : f === 'free_agent' ? 'FA' : f.charAt(0).toUpperCase() + f.slice(1)}
				{#if !loading && counts[f] > 0}
					<span class="text-[10px] font-mono rounded px-1 py-0.5
					             {filter === f ? 'bg-amber-400/15 text-amber-400' : 'bg-navy-800 text-navy-500'}">
						{counts[f]}
					</span>
				{/if}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="space-y-3">
			{#each Array(8) as _}
				<div class="h-16 bg-navy-850 rounded-lg animate-pulse"></div>
			{/each}
		</div>
	{:else if error}
		<p class="text-red-400">Failed to load transactions: {error}</p>
	{:else if filtered.length === 0}
		<p class="text-navy-500">No transactions found.</p>
	{:else}
		<div class="space-y-3">
			{#each filtered as tx (tx.id)}
				{#if tx.type === 'trade'}
					{@const sides = tradeSides(tx)}
					<div class="bg-navy-850 rounded-lg border border-navy-700 overflow-hidden">
						<div class="flex items-center gap-2 px-4 py-2.5 border-b border-navy-700/60">
							<span class="text-xs px-2 py-0.5 rounded-full font-semibold {typeBadge.trade}">Trade</span>
							<span class="text-xs text-slate-500">{tx.date}</span>
						</div>
						<div class="grid divide-x divide-navy-700/50"
						     style="grid-template-columns: repeat({sides.length}, 1fr)">
							{#each sides as side}
								<div class="px-4 py-3">
									<div class="flex items-center gap-2 mb-2">
										{#if side.team?.avatar}
											<img src={side.team.avatar} alt="" class="w-6 h-6 rounded-full shrink-0 object-cover" />
										{:else}
											<div class="w-6 h-6 rounded-full bg-navy-800 shrink-0"></div>
										{/if}
										<span class="text-[11px] font-bold uppercase tracking-wide text-white truncate">
											{side.team?.teamName ?? `Team ${side.rid}`}
										</span>
									</div>
									<p class="text-[9px] text-navy-500 uppercase tracking-widest font-semibold mb-1.5">received</p>
									{#each side.players as move}
										<div class="flex items-center gap-1.5 text-sm mb-0.5">
											<span class="text-[10px] w-6 text-center text-navy-500 shrink-0 font-medium">{playerPos(move.player!)}</span>
											<span class="text-slate-200 truncate">{playerName(move.player!)}</span>
										</div>
									{/each}
									{#each side.picks as pick}
										<div class="flex items-center gap-1.5 text-sm mb-0.5">
											<span class="text-[10px] w-6 text-center text-amber-600/70 shrink-0 font-medium">Rd</span>
											<span class="text-slate-300">{pick.season} Round {pick.round}</span>
										</div>
									{/each}
									{#if side.players.length === 0 && side.picks.length === 0}
										<span class="text-xs text-navy-600 italic">nothing</span>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{:else}
					<div class="bg-navy-850 rounded-lg border border-navy-700 px-4 py-3">
						<div class="flex items-center gap-2 mb-2">
							<span class="text-xs px-2 py-0.5 rounded-full font-semibold {typeBadge[tx.type] ?? 'bg-slate-700 text-slate-300'}">
								{typeLabel[tx.type] ?? tx.type}
							</span>
							<span class="text-xs text-slate-500">{tx.date}</span>
						</div>

						<div class="space-y-1">
							{#each tx.moves as move}
								{#if move.type === 'add' && move.player}
									<div class="flex items-center gap-2 text-sm">
										<span class="text-green-500 text-xs w-3">+</span>
										<span class="text-xs text-slate-600 w-5">{playerPos(move.player)}</span>
										<span class="text-slate-200">{playerName(move.player)}</span>
										<span class="text-xs text-slate-500 ml-auto">{rosterInfoMap.get(move.rosterId)?.teamName}</span>
									</div>
								{:else if move.type === 'drop' && move.player}
									<div class="flex items-center gap-2 text-sm">
										<span class="text-red-500 text-xs w-3">−</span>
										<span class="text-xs text-slate-600 w-5">{playerPos(move.player)}</span>
										<span class="text-slate-400">{playerName(move.player)}</span>
										<span class="text-xs text-slate-500 ml-auto">{rosterInfoMap.get(move.rosterId)?.teamName}</span>
									</div>
								{/if}
							{/each}
						</div>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>
