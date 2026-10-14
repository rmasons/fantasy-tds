<script lang="ts">
	import type { PageData } from './$types';

	let { data } = $props<{ data: PageData }>();

	const TIER_LABEL: Record<number, string> = { 1: 'Tier I', 2: 'Tier II', 3: 'Tier III' };
	const TIER_ACCENT: Record<number, string> = {
		1: 'text-amber-400 border-amber-400/60',
		2: 'text-slate-300 border-slate-400/50',
		3: 'text-orange-500 border-orange-600/50',
	};

	const fmtPP = (amount: number) => (amount >= 0 ? '+' : '−') + Math.abs(amount);

	function standingsForTier(tier: number) {
		return (data.standings ?? []).filter((s: any) => s.tier === tier);
	}

	// ── Weekly breakdown — pick a team to see the itemized work ─────────────────
	let selectedRosterId = $state<number | null>(data.standings?.[0]?.rosterId ?? null);
	const selectedTeamName = $derived(
		data.standings?.find((s: any) => s.rosterId === selectedRosterId)?.teamName ?? '',
	);
	const selectedBreakdown = $derived(
		(data.breakdown ?? [])
			.filter((b: any) => b.rosterId === selectedRosterId)
			.sort((a: any, b: any) => a.week - b.week),
	);

	const MOVEMENT_LABEL: Record<string, string> = {
		'play-in-promotion': 'Promoted (play-in win)',
		'play-in-relegation': 'Relegated (play-in loss)',
		'auto-relegation': 'Relegated (sub-zero PP)',
		'auto-promotion': 'Promoted (replacement)',
		'sub-zero-floor': 'Sub-zero warning (Tier III floor)',
		stay: 'Stays',
	};
	const MOVEMENT_CLASS: Record<string, string> = {
		'play-in-promotion': 'text-green-400 bg-green-500/10',
		'play-in-relegation': 'text-red-400 bg-red-500/10',
		'auto-relegation': 'text-red-400 bg-red-500/10',
		'auto-promotion': 'text-green-400 bg-green-500/10',
		'sub-zero-floor': 'text-amber-400 bg-amber-500/10',
		stay: 'text-navy-500 bg-navy-800',
	};

	const activeMovements = $derived((data.movements ?? []).filter((m: any) => m.reason !== 'stay'));
</script>

<div>
	<div class="mb-6">
		<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">Tiers</h1>
		<p class="text-navy-500 text-[10px] uppercase tracking-[0.2em] font-semibold mt-1">
			{data.season} Season · Promotion Points
		</p>
	</div>

	{#if data.seasons?.length > 1}
		<div class="flex mb-6 border-b border-navy-700 flex-wrap">
			{#each data.seasons as s}
				<a
					href="/league/{s.leagueId}/tiers"
					class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
					       {s.leagueId === data.leagueId ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
				>
					{s.season}
				</a>
			{/each}
		</div>
	{/if}

	{#if !data.isPremier}
		<div class="bg-navy-850 rounded-lg border border-navy-700 p-6 text-center">
			<p class="text-slate-400">This league doesn't run the Premier Keepers ruleset.</p>
		</div>

	{:else if data.loadFailed}
		<div class="bg-navy-850 rounded-lg border border-navy-700 p-6 text-center">
			<p class="text-slate-400">Failed to load Promotion Points.</p>
		</div>

	{:else if data.standings.length === 0}
		<div class="bg-navy-850 rounded-lg border border-navy-700 p-6 text-center">
			<p class="text-slate-400">No tier snapshot for {data.season} yet.</p>
			<p class="text-navy-500 text-sm mt-1">A commissioner needs to seed or hand-enter tiers from League Admin.</p>
		</div>

	{:else}
		{#if data.incompleteTiers.length > 0}
			<div class="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-4">
				<p class="text-amber-300 text-sm font-medium">
					Incomplete tier snapshot: Tier {data.incompleteTiers.join(', Tier ')} {data.incompleteTiers.length === 1 ? 'has' : 'have'} fewer than 4 teams.
				</p>
				<p class="text-amber-300/70 text-sm mt-1">
					Play-ins can't be built for an incomplete tier, so promotion/relegation below may be missing matchups. Assign every roster a tier in League Admin.
				</p>
			</div>
		{/if}

		{#if data.projectionFailed}
			<div class="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-4">
				<p class="text-amber-300 text-sm font-medium">Promotion/relegation projection is unavailable right now.</p>
				<p class="text-amber-300/70 text-sm mt-1">Standings below are accurate; the play-in section could not be computed. Reload to retry.</p>
			</div>
		{/if}

		<!-- Tier standings -->
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
			{#each [1, 2, 3] as tier}
				<div class="bg-navy-850 rounded-lg border border-navy-700 overflow-hidden">
					<div class="px-4 py-3 border-b-2 {TIER_ACCENT[tier]} border-b bg-navy-900">
						<h2 class="font-sport font-bold text-sm uppercase tracking-widest {TIER_ACCENT[tier].split(' ')[0]}">{TIER_LABEL[tier]}</h2>
					</div>
					<div class="divide-y divide-navy-700/50">
						{#each standingsForTier(tier) as row, i}
							<button
								onclick={() => (selectedRosterId = row.rosterId)}
								class="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-navy-800 transition-colors
								       {selectedRosterId === row.rosterId ? 'bg-navy-800' : ''}"
							>
								<span class="font-mono text-xs text-navy-500 w-4 shrink-0">{i + 1}</span>
								{#if row.avatar}
									<img src={row.avatar} alt="" class="w-8 h-8 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
								{:else}
									<div class="w-8 h-8 rounded-full bg-navy-800 flex items-center justify-center shrink-0 text-sm">🏈</div>
								{/if}
								<div class="flex-1 min-w-0">
									<p class="text-sm font-semibold text-white truncate">{row.teamName}</p>
									<p class="text-[10px] text-navy-500">
										{row.weeklyTotal >= 0 ? '+' : ''}{row.weeklyTotal} weekly
										{#if row.manualAdjustment !== 0}
											<span class={row.manualAdjustment >= 0 ? 'text-green-500' : 'text-red-500'}> {fmtPP(row.manualAdjustment)} adj</span>
										{/if}
									</p>
								</div>
								<div class="text-right shrink-0">
									<p class="font-mono font-bold text-sm {row.totalPP < 0 ? 'text-red-400' : 'text-white'}">{fmtPP(row.totalPP)} PP</p>
									<p class="text-[10px] text-navy-500 font-mono">{row.pointsFor.toFixed(1)} PF</p>
								</div>
							</button>
							{#if row.totalPP < 0}
								<div class="px-4 pb-2 -mt-1">
									<span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold text-red-400 bg-red-500/10">
										⚠ Sub-zero — relegation risk
									</span>
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/each}
		</div>

		<!-- Promotion/relegation projection -->
		<section class="bg-navy-850 rounded-lg border border-navy-700 p-6 mb-8">
			<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-1 flex items-center gap-2"><span class="text-amber-400">◆</span>Promotion / Relegation Projection</h2>
			<p class="text-sm text-slate-400 mb-4">
				Week {17} play-in: top two of Tiers II/III challenge the bottom two of the tier above.
				Any team finishing below 0 PP auto-relegates, replaced by the top-PP team from the tier below.
			</p>

			{#if data.playIns.length > 0}
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
					{#each data.playIns as m}
						<div class="rounded-lg border border-navy-700 bg-navy-900 px-4 py-3">
							<p class="text-[10px] uppercase tracking-widest text-navy-500 font-semibold mb-2">
								{TIER_LABEL[m.lowerTier]} #{m.challengerSeed} at {TIER_LABEL[m.upperTier]} #{m.incumbentSeed}
							</p>
							<div class="flex items-center justify-between text-sm">
								<span class="{m.winnerRosterId === m.challenger.rosterId ? 'text-green-400 font-semibold' : 'text-slate-300'}">{m.challenger.teamName}</span>
								<span class="text-navy-600 text-xs">vs</span>
								<span class="{m.winnerRosterId === m.incumbent.rosterId ? 'text-green-400 font-semibold' : 'text-slate-300'}">{m.incumbent.teamName}</span>
							</div>
							<p class="text-[10px] mt-1.5 {m.winnerRosterId ? 'text-navy-500' : 'text-amber-500'}">
								{m.winnerRosterId ? 'Decided' : 'TBD — Week 17 not yet played'}
							</p>
						</div>
					{/each}
				</div>
			{/if}

			{#if activeMovements.length === 0}
				<p class="text-sm text-navy-500">No tier movement projected right now.</p>
			{:else}
				<div class="space-y-1.5">
					{#each activeMovements as m}
						<div class="flex items-center gap-3 py-1.5">
							<span class="text-sm text-slate-300 flex-1">{m.teamName}</span>
							<span class="text-xs text-navy-500">{TIER_LABEL[m.fromTier]}{m.fromTier !== m.toTier ? ` → ${TIER_LABEL[m.toTier]}` : ''}</span>
							<span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold {MOVEMENT_CLASS[m.reason]}">{MOVEMENT_LABEL[m.reason]}</span>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<!-- Weekly itemized breakdown -->
		<section class="bg-navy-850 rounded-lg border border-navy-700 p-6">
			<div class="flex items-center justify-between flex-wrap gap-3 mb-4">
				<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 flex items-center gap-2"><span class="text-amber-400">◆</span>Weekly Breakdown</h2>
				<select
					bind:value={selectedRosterId}
					class="bg-navy-800 border border-navy-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-amber-500"
				>
					{#each data.standings as row}
						<option value={row.rosterId}>{row.teamName}</option>
					{/each}
				</select>
			</div>

			{#if selectedBreakdown.length === 0}
				<p class="text-sm text-navy-500">No weekly data yet for {selectedTeamName}.</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="bg-navy-900 text-navy-500 text-[10px] uppercase tracking-wider border-b border-navy-700">
								<th class="px-3 py-2 text-left">Wk</th>
								<th class="px-3 py-2 text-right">Pts</th>
								<th class="px-3 py-2 text-right">H2H</th>
								<th class="px-3 py-2 text-right">Lg Med</th>
								<th class="px-3 py-2 text-right">Tier Med</th>
								<th class="px-3 py-2 text-right">Total</th>
							</tr>
						</thead>
						<tbody>
							{#each selectedBreakdown as b, i}
								<tr class="border-t border-navy-700/50 {i % 2 !== 0 ? 'bg-navy-875' : ''}">
									<td class="px-3 py-2 text-slate-300 font-mono">{b.week}</td>
									<td class="px-3 py-2 text-right font-mono text-slate-300">{b.points.toFixed(1)}</td>
									<td class="px-3 py-2 text-right font-mono {b.h2h > 0 ? 'text-green-400' : b.h2h < 0 ? 'text-red-400' : 'text-navy-500'}">{fmtPP(b.h2h)}</td>
									<td class="px-3 py-2 text-right font-mono {b.leagueMedian > 0 ? 'text-green-400' : b.leagueMedian < 0 ? 'text-red-400' : 'text-navy-500'}">{fmtPP(b.leagueMedian)}</td>
									<td class="px-3 py-2 text-right font-mono {b.tierMedian > 0 ? 'text-green-400' : b.tierMedian < 0 ? 'text-red-400' : 'text-navy-500'}">{fmtPP(b.tierMedian)}</td>
									<td class="px-3 py-2 text-right font-mono font-bold {b.total > 0 ? 'text-green-400' : b.total < 0 ? 'text-red-400' : 'text-white'}">{fmtPP(b.total)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#if data.manualLedger.length > 0}
				<div class="mt-6 pt-5 border-t border-navy-700">
					<p class="text-xs font-semibold text-navy-500 uppercase tracking-wider mb-3">Manual Adjustments</p>
					<div class="space-y-1.5">
						{#each data.manualLedger as txn}
							<div class="flex items-center gap-3 py-1">
								<span class="text-sm text-slate-300 flex-1 truncate">{txn.teamName} — {txn.reason}</span>
								<span class="font-mono font-bold text-sm {txn.amount >= 0 ? 'text-green-400' : 'text-red-400'}">{fmtPP(txn.amount)}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</section>
	{/if}
</div>
