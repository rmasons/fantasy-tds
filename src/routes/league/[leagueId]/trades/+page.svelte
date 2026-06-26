<script lang="ts">
	import type { PageData } from './$types';
	import type { TradeAnalyticsResult, AnalyzedTrade, WaiverRoiRow } from '$lib/server/tradeAnalytics';

	let { data } = $props<{ data: PageData }>();

	let analytics = $state<TradeAnalyticsResult | null>(data.analytics);
	let seasons = $state(data.seasons);
	let viewLeagueId = $state(data.leagueId);
	let loading = $state(false);
	let error = $state(data.loadFailed ? 'Failed to load trade analytics.' : '');

	// Active tab: 'overview' | 'trades' | 'waiver'
	let activeTab = $state<'overview' | 'trades' | 'waiver'>('overview');

	// Reset to server-rendered data when navigating
	$effect(() => {
		viewLeagueId = data.leagueId;
		analytics = data.analytics;
		seasons = data.seasons;
		loading = false;
		activeTab = 'overview';
		error = data.loadFailed ? 'Failed to load trade analytics.' : '';
	});

	async function selectSeason(lid: string) {
		if (viewLeagueId === lid) return;
		viewLeagueId = lid;
		activeTab = 'overview';

		if (lid === data.leagueId) {
			analytics = data.analytics;
			error = data.loadFailed ? 'Failed to load trade analytics.' : '';
			return;
		}

		analytics = null;
		loading = true;
		error = '';
		try {
			const res = await fetch(`/api/trades/${lid}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const result = await res.json();
			if (viewLeagueId !== lid) return;
			analytics = result;
		} catch (e: any) {
			if (viewLeagueId !== lid) return;
			error = e.message;
		} finally {
			if (viewLeagueId === lid) loading = false;
		}
	}

	function formatDate(ts: number) {
		return new Date(ts).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric',
		});
	}

	function fmtPts(n: number) {
		return n.toFixed(1);
	}

	function swingClass(n: number) {
		if (n > 0) return 'text-green-400';
		if (n < 0) return 'text-red-400';
		return 'text-slate-500';
	}

	function swingLabel(n: number) {
		if (n === 0) return '0';
		return (n > 0 ? '+' : '') + fmtPts(n);
	}

	function roiLabel(roi: number) {
		if (!isFinite(roi)) return '∞';
		return roi.toFixed(2) + 'x';
	}

	function tradeWinner(trade: AnalyzedTrade) {
		const swings = Object.entries(trade.pointSwings);
		if (swings.length === 0) return null;
		return swings.reduce<[string, number] | null>((best, [k, v]) => (!best || v > best[1] ? [k, v] : best), null);
	}

	function tradeLoser(trade: AnalyzedTrade) {
		const swings = Object.entries(trade.pointSwings);
		if (swings.length === 0) return null;
		return swings.reduce<[string, number] | null>((worst, [k, v]) => (!worst || v < worst[1] ? [k, v] : worst), null);
	}

	const trades = $derived(analytics?.trades ?? []);
	const bestTrade = $derived(analytics?.bestTrade ?? null);
	const waiverRoi = $derived(analytics?.waiverRoi ?? []);

	const tabs = [
		{ id: 'overview' as const, label: 'Overview' },
		{ id: 'trades' as const, label: 'All Trades' },
		{ id: 'waiver' as const, label: 'Waiver ROI' },
	];
</script>

<div>
	<!-- Page header -->
	<div class="mb-6">
		<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">
			Trade Analytics
		</h1>
		<p class="text-navy-500 text-[10px] uppercase tracking-[0.2em] font-semibold mt-1">
			Season-wide trade & waiver intelligence
		</p>
	</div>

	<!-- Season picker -->
	{#if seasons.length > 1}
		<div class="flex mb-4 border-b border-navy-700 flex-wrap">
			{#each seasons as s}
				<button
					onclick={() => selectSeason(s.leagueId)}
					class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
					       {viewLeagueId === s.leagueId
					           ? 'text-amber-400 border-b-2 border-amber-400'
					           : 'text-navy-500 hover:text-slate-300'}"
				>
					{s.season}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Tab bar -->
	<div class="flex mb-6 border-b border-navy-700">
		{#each tabs as tab}
			<button
				onclick={() => (activeTab = tab.id)}
				class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
				       {activeTab === tab.id
				           ? 'text-amber-400 border-b-2 border-amber-400'
				           : 'text-navy-500 hover:text-slate-300'}"
			>
				{tab.label}
			</button>
		{/each}
	</div>

	<!-- Loading skeleton -->
	{#if loading}
		<div class="space-y-3">
			{#each Array(6) as _}
				<div class="h-20 bg-navy-850 rounded-lg animate-pulse"></div>
			{/each}
		</div>

	<!-- Error state -->
	{:else if error}
		<div class="bg-navy-850 rounded-lg border border-navy-700 p-6 text-center">
			<p class="text-slate-400">Failed to load trade analytics.</p>
			<p class="text-navy-500 text-sm mt-1">{error}</p>
		</div>

	<!-- Empty state -->
	{:else if !analytics}
		<p class="text-navy-500">No analytics data available.</p>

	<!-- ── OVERVIEW TAB ───────────────────────────────────────────────────── -->
	{:else if activeTab === 'overview'}
		<!-- Summary stats row -->
		<div class="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
			<div class="bg-navy-850 rounded-lg border border-navy-700 p-4">
				<p class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-1">Total Trades</p>
				<p class="text-3xl font-black font-sport text-white">{analytics.totalTrades}</p>
			</div>
			<div class="bg-navy-850 rounded-lg border border-navy-700 p-4">
				<p class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-1">Waiver Moves</p>
				<p class="text-3xl font-black font-sport text-white">{analytics.totalWaiverTransactions}</p>
			</div>
			<div class="bg-navy-850 rounded-lg border border-navy-700 p-4 col-span-2 sm:col-span-1">
				<p class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-1">Managers Active</p>
				<p class="text-3xl font-black font-sport text-white">{waiverRoi.length}</p>
			</div>
		</div>

		<!-- Best trade card -->
		{#if bestTrade}
			{@const winner = tradeWinner(bestTrade)}
			{@const loser = tradeLoser(bestTrade)}
			<section class="bg-navy-850 rounded-lg border border-navy-700 p-6 mb-6">
				<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-4">
					Most Lopsided Trade
					<span class="ml-2 text-amber-400 font-mono text-xs normal-case tracking-normal">
						Wk {bestTrade.week} · {formatDate(bestTrade.date)}
					</span>
				</h2>
				<div class="grid divide-x divide-navy-700/50"
				     style="grid-template-columns: repeat({bestTrade.parties.length}, 1fr)">
					{#each bestTrade.parties as party}
						{@const swing = bestTrade.pointSwings[party.rosterId] ?? 0}
						<div class="px-4 first:pl-0 last:pr-0">
							<div class="flex items-center gap-2 mb-2">
								{#if party.avatar}
									<img src={party.avatar} alt="" class="w-7 h-7 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
								{:else}
									<div class="w-7 h-7 rounded-full bg-navy-800 shrink-0 flex items-center justify-center text-sm">🏈</div>
								{/if}
								<span class="text-sm font-bold text-white truncate">{party.teamName}</span>
							</div>

							<p class="text-[9px] text-navy-500 uppercase tracking-widest font-semibold mb-1">Received</p>
							{#each party.received as asset}
								<p class="text-xs text-slate-300 truncate mb-0.5">
									{asset.type === 'pick' ? '📋' : '🏈'} {asset.label}
								</p>
							{/each}
							{#if party.received.length === 0}
								<p class="text-xs text-navy-600 italic">nothing</p>
							{/if}

							<div class="mt-3 pt-2 border-t border-navy-700/40">
								<p class="text-[9px] text-navy-500 uppercase tracking-widest font-semibold">Net pts</p>
								<p class="text-lg font-black font-mono {swingClass(swing)}">{swingLabel(swing)}</p>
							</div>
						</div>
					{/each}
				</div>
				<div class="mt-4 pt-3 border-t border-navy-700/40 flex flex-wrap gap-6">
					{#if winner && winner[1] > 0}
						{@const winParty = bestTrade.parties.find(p => p.rosterId === Number(winner[0]))}
						<div>
							<p class="text-[9px] text-green-400 uppercase tracking-widest font-semibold">Winner</p>
							<p class="text-sm font-semibold text-white">{winParty?.teamName ?? `Team ${winner[0]}`}</p>
							<p class="text-xs text-green-400 font-mono">+{fmtPts(winner[1])} pts</p>
						</div>
					{/if}
					{#if loser && loser[1] < 0}
						{@const loseParty = bestTrade.parties.find(p => p.rosterId === Number(loser[0]))}
						<div>
							<p class="text-[9px] text-red-400 uppercase tracking-widest font-semibold">Loser</p>
							<p class="text-sm font-semibold text-white">{loseParty?.teamName ?? `Team ${loser[0]}`}</p>
							<p class="text-xs text-red-400 font-mono">{fmtPts(loser[1])} pts</p>
						</div>
					{/if}
				</div>
			</section>
		{/if}

		<!-- Waiver ROI leaderboard (top 5) -->
		{#if waiverRoi.length > 0}
			<section class="bg-navy-850 rounded-lg border border-navy-700 p-6 mb-6">
				<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-4">
					Waiver ROI — Top Managers
				</h2>

				<!-- Desktop table -->
				<div class="hidden sm:block overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="text-[10px] uppercase tracking-wider text-navy-500 border-b border-navy-700">
								<th class="pb-2 text-left">#</th>
								<th class="pb-2 text-left">Manager</th>
								<th class="pb-2 text-right">FAAB Spent</th>
								<th class="pb-2 text-right">Pts Gained</th>
								<th class="pb-2 text-right">ROI</th>
								<th class="pb-2 text-left pl-4">Top Pickup</th>
							</tr>
						</thead>
						<tbody>
							{#each waiverRoi.slice(0, 10) as row, i}
								<tr class="border-t border-navy-700/40 {i % 2 !== 0 ? 'bg-navy-875/30' : ''}">
									<td class="py-2.5 pr-3 font-mono text-xs text-navy-500">{i + 1}</td>
									<td class="py-2.5 pr-4">
										<div class="flex items-center gap-2">
											{#if row.avatar}
												<img src={row.avatar} alt="" class="w-7 h-7 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
											{:else}
												<div class="w-7 h-7 rounded-full bg-navy-800 shrink-0"></div>
											{/if}
											<span class="font-semibold text-white text-sm">{row.teamName}</span>
										</div>
									</td>
									<td class="py-2.5 text-right font-mono tabular-nums text-slate-400">
										${row.faabSpent}
									</td>
									<td class="py-2.5 text-right font-mono tabular-nums text-amber-400 font-semibold">
										{fmtPts(row.pointsGained)}
									</td>
									<td class="py-2.5 text-right font-mono tabular-nums {row.roi >= 1 ? 'text-green-400' : 'text-red-400'}">
										{roiLabel(row.roi)}
									</td>
									<td class="py-2.5 pl-4 text-xs text-slate-400">
										{#if row.topPickups[0]}
											{row.topPickups[0].playerName}
											<span class="text-navy-500 ml-1">
												({fmtPts(row.topPickups[0].pointsAfterPickup)} pts)
											</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<!-- Mobile cards -->
				<div class="sm:hidden space-y-2">
					{#each waiverRoi.slice(0, 10) as row, i}
						<div class="flex items-center gap-3 py-2 border-t border-navy-700/40 first:border-0">
							<span class="font-mono text-xs text-navy-500 w-5 text-center">{i + 1}</span>
							{#if row.avatar}
								<img src={row.avatar} alt="" class="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
							{:else}
								<div class="w-9 h-9 rounded-full bg-navy-800 shrink-0"></div>
							{/if}
							<div class="flex-1 min-w-0">
								<p class="font-semibold text-white text-sm truncate">{row.teamName}</p>
								<p class="text-xs text-slate-400">{fmtPts(row.pointsGained)} pts · ${row.faabSpent} FAAB</p>
							</div>
							<div class="text-right shrink-0">
								<p class="font-mono font-bold text-sm {row.roi >= 1 ? 'text-green-400' : 'text-red-400'}">{roiLabel(row.roi)}</p>
								<p class="text-[10px] text-navy-500 uppercase tracking-wide">ROI</p>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

	<!-- ── ALL TRADES TAB ─────────────────────────────────────────────────── -->
	{:else if activeTab === 'trades'}
		{#if trades.length === 0}
			<p class="text-navy-500">No trades found for this season.</p>
		{:else}
			<div class="space-y-3">
				{#each trades as trade (trade.transactionId)}
					{@const winner = tradeWinner(trade)}
					{@const hasSwings = Object.values(trade.pointSwings).some(v => v !== 0)}
					<div class="bg-navy-850 rounded-lg border border-navy-700 overflow-hidden">
						<!-- Trade header -->
						<div class="flex items-center gap-2 px-4 py-2.5 border-b border-navy-700/60 flex-wrap">
							<span class="text-xs px-2 py-0.5 rounded-full font-semibold bg-purple-900/60 text-purple-300">Trade</span>
							<span class="text-xs text-slate-500">Wk {trade.week} · {formatDate(trade.date)}</span>
							{#if hasSwings && winner && Math.abs(winner[1]) > 0.1}
								<span class="ml-auto text-[10px] text-slate-500">
									Imbalance: <span class="font-mono text-amber-400">{fmtPts(trade.imbalanceScore)} pts</span>
								</span>
							{/if}
						</div>

						<!-- Party columns -->
						<div class="grid divide-x divide-navy-700/50"
						     style="grid-template-columns: repeat({trade.parties.length}, 1fr)">
							{#each trade.parties as party}
								{@const swing = trade.pointSwings[party.rosterId] ?? 0}
								<div class="px-3 sm:px-4 py-3">
									<div class="flex items-center gap-2 mb-2">
										{#if party.avatar}
											<img src={party.avatar} alt="" class="w-6 h-6 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
										{:else}
											<div class="w-6 h-6 rounded-full bg-navy-800 shrink-0"></div>
										{/if}
										<span class="text-[11px] font-bold uppercase tracking-wide text-white truncate">
											{party.teamName}
										</span>
									</div>

									<p class="text-[9px] text-navy-500 uppercase tracking-widest font-semibold mb-1">Received</p>
									{#each party.received as asset}
										<p class="text-xs text-slate-300 truncate mb-0.5">
											{asset.type === 'pick' ? '📋' : '🏈'} {asset.label}
										</p>
									{/each}
									{#if party.received.length === 0}
										<p class="text-xs text-navy-600 italic">nothing</p>
									{/if}

									{#if hasSwings}
										<div class="mt-2 pt-1.5 border-t border-navy-700/30">
											<span class="text-[9px] text-navy-500 uppercase tracking-widest">Net</span>
											<span class="ml-1 text-xs font-mono font-bold {swingClass(swing)}">{swingLabel(swing)}</span>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}

	<!-- ── WAIVER ROI TAB ─────────────────────────────────────────────────── -->
	{:else if activeTab === 'waiver'}
		{#if waiverRoi.length === 0}
			<p class="text-navy-500">No waiver data available for this season.</p>
		{:else}
			<p class="text-slate-400 text-sm mb-4">
				Points scored by waiver-wire pickups (starters only, from the week of acquisition onward).
			</p>
			<div class="space-y-4">
				{#each waiverRoi as row, i}
					<div class="bg-navy-850 rounded-lg border border-navy-700 p-4">
						<div class="flex items-center gap-3 mb-3">
							<span class="font-mono text-sm text-navy-500 w-6 shrink-0">{i + 1}</span>
							{#if row.avatar}
								<img src={row.avatar} alt="" class="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
							{:else}
								<div class="w-9 h-9 rounded-full bg-navy-800 shrink-0 flex items-center justify-center text-base">🏈</div>
							{/if}
							<div class="flex-1 min-w-0">
								<p class="font-semibold text-white">{row.teamName}</p>
							</div>
							<div class="text-right shrink-0">
								<p class="font-mono font-bold text-lg {row.roi >= 1 ? 'text-green-400' : 'text-red-400'}">{roiLabel(row.roi)}</p>
								<p class="text-[10px] text-navy-500 uppercase tracking-wide">ROI</p>
							</div>
						</div>

						<!-- Stat pills -->
						<div class="flex gap-4 flex-wrap mb-3">
							<div>
								<p class="text-[9px] text-navy-500 uppercase tracking-widest font-semibold">FAAB Spent</p>
								<p class="text-sm font-mono font-bold text-slate-200">${row.faabSpent}</p>
							</div>
							<div>
								<p class="text-[9px] text-navy-500 uppercase tracking-widest font-semibold">Pts Gained</p>
								<p class="text-sm font-mono font-bold text-amber-400">{fmtPts(row.pointsGained)}</p>
							</div>
						</div>

						<!-- Top pickups -->
						{#if row.topPickups.length > 0}
							<div class="border-t border-navy-700/40 pt-2.5">
								<p class="text-[9px] text-navy-500 uppercase tracking-widest font-semibold mb-2">Top Pickups</p>
								<div class="space-y-1">
									{#each row.topPickups as pickup}
										<div class="flex items-center gap-2 text-xs">
											<span class="text-slate-300 flex-1 truncate">{pickup.playerName}</span>
											<span class="font-mono text-amber-400 tabular-nums shrink-0">
												{fmtPts(pickup.pointsAfterPickup)} pts
											</span>
											{#if pickup.faabBid > 0}
												<span class="font-mono text-slate-500 tabular-nums shrink-0">
													${pickup.faabBid}
												</span>
											{/if}
										</div>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
