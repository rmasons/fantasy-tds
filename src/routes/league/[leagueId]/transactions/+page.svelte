<script lang="ts">
	import type { PageData } from './$types';
	import type { SlimPlayer } from '$lib/types';
	import type { RosterInfo } from '$lib/sleeper';

	let { data } = $props<{ data: PageData }>();

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
		date: number;
		rosterIds: number[];
		moves: TxMove[];
	}

	let transactions = $state<Transaction[]>(data.transactions);
	let filter = $state<TxType>('all');
	let loading = $state(false);
	let error = $state(data.loadFailed ? 'Failed to load transactions.' : '');
	let seasons = $state(data.seasons);
	let viewLeagueId = $state(data.leagueId);

	let rosterInfoMap = $state(new Map(Object.entries(data.rosterInfo).map(([k, v]) => [Number(k), v as RosterInfo])));
	let players = $state<Record<string, SlimPlayer>>(data.players);

	// Reset to the route league's server-rendered data whenever we navigate.
	$effect(() => {
		viewLeagueId = data.leagueId;
		seasons = data.seasons;
		transactions = data.transactions;
		rosterInfoMap = new Map(Object.entries(data.rosterInfo).map(([k, v]) => [Number(k), v as RosterInfo]));
		players = data.players;
		filter = 'all';
		loading = false;
		error = data.loadFailed ? 'Failed to load transactions.' : '';
	});

	async function selectSeason(lid: string) {
		if (viewLeagueId === lid) return;
		viewLeagueId = lid;
		filter = 'all';

		// The route league's transactions already came down with the page (SSR).
		if (lid === data.leagueId) {
			transactions = data.transactions;
			rosterInfoMap = new Map(Object.entries(data.rosterInfo).map(([k, v]) => [Number(k), v as RosterInfo]));
			players = data.players;
			error = data.loadFailed ? 'Failed to load transactions.' : '';
			return;
		}

		transactions = [];
		loading = true;
		error = '';
		try {
			const res = await fetch(`/api/transactions/${lid}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const result = await res.json();
			if (viewLeagueId !== lid) return;
			transactions = result.transactions;
			rosterInfoMap = new Map(Object.entries(result.rosterInfo).map(([k, v]) => [Number(k), v as RosterInfo]));
			players = result.players;
		} catch (e: any) {
			if (viewLeagueId !== lid) return;
			error = e.message;
		} finally {
			if (viewLeagueId === lid) loading = false;
		}
	}

	function formatDate(ts: number) {
		return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function playerName(id: string) {
		return players[id]?.name ?? id;
	}
	function playerPos(id: string) {
		return players[id]?.pos ?? '?';
	}
	function playerNumber(id: string): number | undefined {
		return players[id]?.number;
	}
	function teamLogoUrl(id: string): string | null {
		const team = players[id]?.team;
		if (!team || team === 'FA' || team === '?') return null;
		return `https://sleepercdn.com/images/team_logos/nfl/${team.toLowerCase()}.png`;
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

	{#if seasons.length > 1}
		<div class="flex mb-4 border-b border-navy-700 flex-wrap">
			{#each seasons as s}
				<button
					onclick={() => selectSeason(s.leagueId)}
					class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
					       {viewLeagueId === s.leagueId ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
				>
					{s.season}
				</button>
			{/each}
		</div>
	{/if}

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
							<span class="text-xs text-slate-500">{formatDate(tx.date)}</span>
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
											{#if teamLogoUrl(move.player!)}
												<img src={teamLogoUrl(move.player!)} alt="" class="w-4 h-4 shrink-0 object-contain" />
											{/if}
											<span class="text-slate-200 truncate">{playerName(move.player!)}</span>
											{#if playerNumber(move.player!) != null}
												<span class="text-[10px] text-navy-500 shrink-0 font-mono">#{playerNumber(move.player!)}</span>
											{/if}
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
							<span class="text-xs text-slate-500">{formatDate(tx.date)}</span>
						</div>

						<div class="space-y-1">
							{#each tx.moves as move}
								{#if move.type === 'add' && move.player}
									<div class="flex items-center gap-2 text-sm">
										<span class="text-green-500 text-xs w-3">+</span>
										<span class="text-xs text-slate-600 w-5">{playerPos(move.player)}</span>
										{#if teamLogoUrl(move.player)}
											<img src={teamLogoUrl(move.player)} alt="" class="w-4 h-4 shrink-0 object-contain" />
										{/if}
										<span class="text-slate-200">{playerName(move.player)}</span>
										{#if playerNumber(move.player) != null}
											<span class="text-[10px] text-navy-500 font-mono">#{playerNumber(move.player)}</span>
										{/if}
										<span class="text-xs text-slate-500 ml-auto">{rosterInfoMap.get(move.rosterId)?.teamName}</span>
									</div>
								{:else if move.type === 'drop' && move.player}
									<div class="flex items-center gap-2 text-sm">
										<span class="text-red-500 text-xs w-3">−</span>
										<span class="text-xs text-slate-600 w-5">{playerPos(move.player)}</span>
										{#if teamLogoUrl(move.player)}
											<img src={teamLogoUrl(move.player)} alt="" class="w-4 h-4 shrink-0 object-contain" />
										{/if}
										<span class="text-slate-400">{playerName(move.player)}</span>
										{#if playerNumber(move.player) != null}
											<span class="text-[10px] text-navy-500 font-mono">#{playerNumber(move.player)}</span>
										{/if}
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
