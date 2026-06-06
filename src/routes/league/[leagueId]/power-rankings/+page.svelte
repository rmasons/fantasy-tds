<script lang="ts">
	import type { PageData } from './$types';
	import type { PowerRankingsData } from '$lib/server/powerRankings';
	import FaabEasterEgg from '$lib/components/FaabEasterEgg.svelte';

	let { data } = $props<{ data: PageData }>();

	interface PowerRank {
		rosterId: number;
		teamName: string;
		ownerName: string | null;
		avatar: string | null;
		wins: number;       // H2H wins through selectedWeek
		losses: number;
		ties: number;
		totalPF: number;    // cumulative through selectedWeek
		score: number;      // PF × (2 + h2hWin% + medianWin%)
		rank: number;
		delta: number | null;
		playoffOdds: number | null;
	}

	interface RosterBase {
		rosterId: number;
		teamName: string;
		ownerName: string | null;
		avatar: string | null;
		wins: number;     // official Sleeper record (includes median wins if enabled)
		losses: number;
		ties: number;
		totalPF: number;  // official season total PF
	}

	let loading = $state(false);
	let error = $state(data.loadFailed ? 'Failed to load power rankings.' : '');
	let seasons = $state(data.seasons);
	let viewLeagueId = $state(data.leagueId);

	let rosterBaseData = $state<RosterBase[]>(data.power?.rosterBaseData ?? []);
	let weekScoreMap = $state<Map<number, Map<number, number>>>(new Map());
	let weekMatchupPairs = $state<Map<number, [number, number][]>>(new Map());
	let weekMedians = $state<Map<number, number>>(new Map());
	let futureSchedule = $state<[number, number][][]>([]);
	let selectedWeek = $state(0);
	let currentWeek = $state(0);
	let weeksRemaining = $state(0);
	let playoffSpots = $state(0);

	const SIM_COUNT = 10_000;

	// Server returns array-encoded data (JSON-safe); reconstruct the Maps here.
	function applyBundle(d: PowerRankingsData | null) {
		rosterBaseData = d?.rosterBaseData ?? [];
		weekScoreMap = new Map((d?.weekScores ?? []).map(([w, arr]) => [w, new Map(arr)]));
		weekMatchupPairs = new Map(d?.weekPairs ?? []);
		weekMedians = new Map(d?.weekMedians ?? []);
		futureSchedule = d?.futureSchedule ?? [];
		currentWeek = d?.currentWeek ?? 0;
		weeksRemaining = d?.weeksRemaining ?? 0;
		playoffSpots = d?.playoffSpots ?? 0;
		selectedWeek = d?.currentWeek ?? 0;
	}

	// ── Power score computation ────────────────────────────────────────────────

	function computePowerRankMap(
		rosterIds: number[],
		throughWeek: number,
		scoreMap: Map<number, Map<number, number>>,
		pairMap: Map<number, [number, number][]>,
		medianMap: Map<number, number>
	): Map<number, { score: number; rank: number; wins: number; losses: number; ties: number; pf: number }> {
		const w = new Map(rosterIds.map((id) => [id, 0]));
		const l = new Map(rosterIds.map((id) => [id, 0]));
		const t = new Map(rosterIds.map((id) => [id, 0]));
		const pf = new Map(rosterIds.map((id) => [id, 0]));
		const mw = new Map(rosterIds.map((id) => [id, 0]));

		for (let week = 1; week <= throughWeek; week++) {
			const scores = scoreMap.get(week) ?? new Map<number, number>();
			const pairs = pairMap.get(week) ?? [];
			const median = medianMap.get(week) ?? 0;

			for (const [a, b] of pairs) {
				const sa = scores.get(a) ?? 0;
				const sb = scores.get(b) ?? 0;
				if (sa > sb) { w.set(a, w.get(a)! + 1); l.set(b, l.get(b)! + 1); }
				else if (sb > sa) { w.set(b, w.get(b)! + 1); l.set(a, l.get(a)! + 1); }
				else { t.set(a, t.get(a)! + 1); t.set(b, t.get(b)! + 1); }
			}

			for (const [id, pts] of scores) {
				pf.set(id, (pf.get(id) ?? 0) + pts);
				if (pts > median) mw.set(id, mw.get(id)! + 1);
			}
		}

		const entries = rosterIds.map((id) => {
			const wins = w.get(id) ?? 0;
			const losses = l.get(id) ?? 0;
			const ties = t.get(id) ?? 0;
			const points = pf.get(id) ?? 0;
			const medWins = mw.get(id) ?? 0;
			const games = wins + losses + ties;
			const h2hWinPct = games > 0 ? (wins + 0.5 * ties) / games : 0;
			const medWinPct = throughWeek > 0 ? medWins / throughWeek : 0;
			const score = points * (2 + h2hWinPct + medWinPct);
			return { id, score, rank: 0, wins, losses, ties, pf: points };
		});

		entries.sort((a, b) => b.score - a.score);
		const result = new Map<number, { score: number; rank: number; wins: number; losses: number; ties: number; pf: number }>();
		entries.forEach((e, i) => result.set(e.id, { ...e, rank: i + 1 }));
		return result;
	}

	// ── Monte Carlo simulation ─────────────────────────────────────────────────

	function randn(): number {
		return Math.sqrt(-2 * Math.log(Math.random())) * Math.cos(2 * Math.PI * Math.random());
	}

	function simulateOdds(
		teams: { rosterId: number; wins: number; losses: number; totalPF: number; weeklyAvgPts: number }[],
		schedule: [number, number][][],
		spots: number
	): Map<number, number> {
		const leagueAvg = teams.reduce((s, t) => s + t.weeklyAvgPts, 0) / (teams.length || 1) || 100;
		const expScore = new Map(teams.map((t) => [t.rosterId, t.weeklyAvgPts > 0 ? t.weeklyAvgPts : leagueAvg]));
		const qualified = new Map(teams.map((t) => [t.rosterId, 0]));

		for (let sim = 0; sim < SIM_COUNT; sim++) {
			const simWins = new Map(teams.map((t) => [t.rosterId, t.wins]));
			const simPF = new Map(teams.map((t) => [t.rosterId, t.totalPF]));

			for (const weekMatchups of schedule) {
				for (const [a, b] of weekMatchups) {
					const ptsA = Math.max(0, expScore.get(a)! + randn() * 20);
					const ptsB = Math.max(0, expScore.get(b)! + randn() * 20);
					if (ptsA >= ptsB) simWins.set(a, simWins.get(a)! + 1);
					else simWins.set(b, simWins.get(b)! + 1);
					simPF.set(a, simPF.get(a)! + ptsA);
					simPF.set(b, simPF.get(b)! + ptsB);
				}
			}

			const ranked = [...teams].sort((x, y) => {
				const wDiff = simWins.get(y.rosterId)! - simWins.get(x.rosterId)!;
				return wDiff !== 0 ? wDiff : simPF.get(y.rosterId)! - simPF.get(x.rosterId)!;
			});

			for (let i = 0; i < Math.min(spots, ranked.length); i++) {
				qualified.set(ranked[i].rosterId, qualified.get(ranked[i].rosterId)! + 1);
			}
		}

		return new Map([...qualified.entries()].map(([id, n]) => [id, (n / SIM_COUNT) * 100]));
	}

	// ── Main data load ─────────────────────────────────────────────────────────

	// Reset to the route league's server-rendered data whenever we navigate.
	$effect(() => {
		viewLeagueId = data.leagueId;
		seasons = data.seasons;
		loading = false;
		error = data.loadFailed ? 'Failed to load power rankings.' : '';
		applyBundle(data.power);
	});

	async function selectSeason(lid: string) {
		if (viewLeagueId === lid) return;
		viewLeagueId = lid;

		// The route league's data already came down with the page (SSR).
		if (lid === data.leagueId) {
			applyBundle(data.power);
			error = data.loadFailed ? 'Failed to load power rankings.' : '';
			return;
		}

		loading = true;
		error = '';
		try {
			const res = await fetch(`/api/power-rankings/${lid}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const result: PowerRankingsData = await res.json();
			if (viewLeagueId !== lid) return;
			applyBundle(result);
		} catch (e: any) {
			if (viewLeagueId !== lid) return;
			error = e.message;
			applyBundle(null);
		} finally {
			if (viewLeagueId === lid) loading = false;
		}
	}

	// ── Reactive rankings ─────────────────────────────────────────────────────

	const rankings = $derived.by((): PowerRank[] => {
		if (rosterBaseData.length === 0) return [];

		const rosterIds = rosterBaseData.map((r) => r.rosterId);

		if (weekScoreMap.size === 0) {
			const rows: PowerRank[] = rosterBaseData.map((r) => ({
				...r,
				score: r.totalPF,
				rank: 0,
				delta: null,
				playoffOdds: null,
			}));
			rows.sort((a, b) => b.wins - a.wins || b.totalPF - a.totalPF);
			rows.forEach((r, i) => (r.rank = i + 1));
			return rows;
		}

		const currMap = computePowerRankMap(rosterIds, selectedWeek, weekScoreMap, weekMatchupPairs, weekMedians);
		const prevMap = selectedWeek > 1
			? computePowerRankMap(rosterIds, selectedWeek - 1, weekScoreMap, weekMatchupPairs, weekMedians)
			: null;

		const rows: PowerRank[] = rosterBaseData.map((r) => {
			const curr = currMap.get(r.rosterId) ?? { score: 0, rank: 0, wins: r.wins, losses: r.losses, ties: r.ties, pf: r.totalPF };
			const prev = prevMap?.get(r.rosterId) ?? null;
			return {
				...r,
				wins: curr.wins,
				losses: curr.losses,
				ties: curr.ties,
				totalPF: curr.pf,
				score: curr.score,
				rank: curr.rank,
				delta: prev !== null ? prev.rank - curr.rank : null,
				playoffOdds: null,
			};
		});
		rows.sort((a, b) => a.rank - b.rank);

		if (selectedWeek > 0) {
			const historicalFutureWeeks = Array.from(
				{ length: currentWeek - selectedWeek },
				(_, i) => selectedWeek + 1 + i
			).map((w) => weekMatchupPairs.get(w) ?? ([] as [number, number][]));

			const scheduleFromHere: [number, number][][] = [...historicalFutureWeeks, ...futureSchedule];
			const totalRemainingFromHere = currentWeek + weeksRemaining - selectedWeek;

			let oddsMap: Map<number, number> | null = null;

			if (totalRemainingFromHere > 0 && scheduleFromHere.some((w) => w.length > 0)) {
				const simInput = rows.map((r) => ({
					rosterId: r.rosterId,
					wins: r.wins,
					losses: r.losses,
					totalPF: r.totalPF,
					weeklyAvgPts: selectedWeek > 0 ? r.totalPF / selectedWeek : 0,
				}));
				oddsMap = simulateOdds(simInput, scheduleFromHere, playoffSpots);

				const remGames = new Map<number, number>(rows.map((r) => [r.rosterId, 0]));
				for (const week of scheduleFromHere) {
					for (const [a, b] of week) {
						remGames.set(a, (remGames.get(a) ?? 0) + 1);
						remGames.set(b, (remGames.get(b) ?? 0) + 1);
					}
				}
				for (const row of rows) {
					const maxWins = row.wins + (remGames.get(row.rosterId) ?? 0);
					const others = rows.filter((r) => r.rosterId !== row.rosterId);

					const canMatch = others.filter(
						(o) => o.wins + (remGames.get(o.rosterId) ?? 0) >= row.wins
					).length;
					if (canMatch < playoffSpots) {
						oddsMap.set(row.rosterId, 100);
						continue;
					}

					const definitelyAhead = others.filter((o) => o.wins > maxWins).length;
					if (definitelyAhead >= playoffSpots) {
						oddsMap.set(row.rosterId, 0);
					}
				}
			} else if (totalRemainingFromHere === 0) {
				const officialRanked = rosterBaseData
					.slice()
					.sort((a, b) => b.wins - a.wins || b.totalPF - a.totalPF);
				oddsMap = new Map(officialRanked.map((r, i) => [r.rosterId, i < playoffSpots ? 100 : 0]));
			}

			if (oddsMap) {
				for (const row of rows) row.playoffOdds = oddsMap.get(row.rosterId) ?? null;
			}
		}

		return rows;
	});

	// ── Display helpers ────────────────────────────────────────────────────────

	function deltaLabel(d: number | null): string {
		if (d === null || d === 0) return '—';
		return d > 0 ? `▲${d}` : `▼${Math.abs(d)}`;
	}

	function deltaClass(d: number | null): string {
		if (d === null || d === 0) return 'text-slate-600';
		return d > 0 ? 'text-emerald-400' : 'text-red-400';
	}

	function oddsClass(odds: number | null): string {
		if (odds === null) return 'text-slate-600';
		if (odds === 100) return 'text-emerald-300 font-bold';
		if (odds === 0) return 'text-red-500 font-bold';
		if (odds >= 80) return 'text-emerald-400 font-bold';
		if (odds >= 50) return 'text-emerald-600';
		if (odds >= 20) return 'text-slate-400';
		return 'text-red-400';
	}

	function oddsLabel(odds: number | null, isFinal = false): string {
		if (odds === null) return '—';
		if (odds === 100) return '100%';
		if (odds === 0) return '0%';
		if (odds >= 99.5) return isFinal ? '100%' : '99%';
		if (odds <= 0.5) return '<1%';
		return `${odds.toFixed(0)}%`;
	}

	function rankBadge(rank: number): string {
		if (rank === 1) return 'text-amber-400 font-bold';
		if (rank === 2) return 'text-slate-300 font-semibold';
		if (rank === 3) return 'text-amber-700 font-semibold';
		return 'text-slate-500';
	}

	const isCurrentView = $derived(selectedWeek === currentWeek && currentWeek > 0);
	const weeksRemainingFromHere = $derived(currentWeek + weeksRemaining - selectedWeek);
	const playoffLine = $derived(rankings.length > 0 && playoffSpots > 0 ? playoffSpots : null);
</script>

<div>
	<!-- Header -->
	<div class="flex items-start justify-between mb-6 flex-wrap gap-3">
		<div>
			<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">Power Rankings</h1>
			<p class="text-navy-500 text-[10px] uppercase tracking-[0.2em] font-semibold mt-1">
				{#if currentWeek === 0}
					Pre-season · ordered by record
				{:else if !isCurrentView}
					Historical · as of Week {selectedWeek}
				{:else if weeksRemaining === 0}
					Final · regular season complete
				{:else}
					Week {currentWeek} · {weeksRemaining} week{weeksRemaining !== 1 ? 's' : ''} remaining
				{/if}
				</p>
		</div>

		<!-- Week navigator -->
		{#if currentWeek > 0 && !loading}
			<div class="flex items-center gap-0.5 bg-navy-850 rounded-lg p-1 border border-navy-700">
				<button
					onclick={() => { if (selectedWeek > 1) selectedWeek -= 1; }}
					disabled={selectedWeek <= 1}
					class="px-3 py-1.5 rounded text-sm text-navy-500 hover:text-white disabled:opacity-30 transition-colors"
				>‹</button>
				<select
					value={selectedWeek}
					onchange={(e) => { selectedWeek = parseInt((e.target as HTMLSelectElement).value); }}
					class="bg-transparent text-sm font-semibold text-white px-2 py-1.5 focus:outline-none cursor-pointer"
				>
					{#each Array.from({ length: currentWeek }, (_, i) => i + 1) as w}
						<option value={w} class="bg-navy-850">
							Week {w}{w === currentWeek ? ' (current)' : ''}
						</option>
					{/each}
				</select>
				<button
					onclick={() => { if (selectedWeek < currentWeek) selectedWeek += 1; }}
					disabled={selectedWeek >= currentWeek}
					class="px-3 py-1.5 rounded text-sm text-navy-500 hover:text-white disabled:opacity-30 transition-colors"
				>›</button>
			</div>
		{/if}
	</div>

	{#if seasons.length > 1}
		<div class="flex mb-6 border-b border-navy-700 flex-wrap">
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

	{#if loading}
		<div class="space-y-2">
			{#each Array(10) as _}
				<div class="h-14 bg-navy-850 rounded-lg animate-pulse"></div>
			{/each}
		</div>

	{:else if error}
		<div class="bg-navy-850 rounded-lg border border-navy-700 p-6 text-center">
			<p class="text-navy-500">Failed to load power rankings.</p>
			<p class="text-navy-500 text-sm mt-1">{error}</p>
		</div>

	{:else if rankings.length === 0}
		<p class="text-navy-500">No data available yet.</p>

	{:else}
		<!-- Sub-header -->
		{#if currentWeek > 0}
			<div class="mb-4 flex flex-wrap items-center gap-3 text-xs text-navy-500">
				{#if !isCurrentView}
					<span class="inline-flex items-center bg-navy-850 text-slate-400 text-xs font-medium px-2.5 py-1 rounded ring-1 ring-navy-700">
						Historical view
					</span>
				{/if}
				<span>Score = (PF × 2) + (PF × Win%) + (PF × Median Win%)</span>
				<span class="text-slate-700">·</span>
				{#if weeksRemainingFromHere > 0}
					<span>Playoff % = {SIM_COUNT.toLocaleString()}-sim Monte Carlo,
						top {playoffSpots} qualify ({weeksRemainingFromHere} wk{weeksRemainingFromHere !== 1 ? 's' : ''} remaining)</span>
				{:else}
					<span>Playoff % = actual final standings</span>
				{/if}
			</div>
		{/if}

		<!-- Desktop table -->
		<div class="hidden sm:block overflow-x-auto rounded-lg border border-navy-700">
			<table class="w-full text-sm">
				<thead>
					<tr class="bg-navy-900 text-navy-500 text-[10px] uppercase tracking-wider border-b border-navy-700">
						<th class="px-4 py-3 text-left w-8">#</th>
						<th class="px-3 py-3 text-center w-10">Δ</th>
						<th class="px-4 py-3 text-left">Team</th>
						<th class="px-4 py-3 text-center">Record</th>
						<th class="px-4 py-3 text-right">Total PF</th>
						<th class="px-4 py-3 text-right">Score{#if viewLeagueId === data.leagueId}<FaabEasterEgg eggId="5" leagueId={data.leagueId} loggedIn={!!data.user} />{/if}</th>
						<th class="px-4 py-3 text-right">Playoff %</th>
					</tr>
				</thead>
				<tbody>
					{#each rankings as row, i}
						{@const atCutline = playoffLine !== null && i === playoffLine - 1}
						{@const belowCutline = playoffLine !== null && i >= playoffLine}
						<tr class="border-t border-navy-700/50 hover:bg-navy-800 transition-colors
						           {i % 2 !== 0 ? 'bg-navy-875' : ''}
						           {row.rank === 1 ? 'bg-amber-500/5' : ''}
						           {belowCutline ? 'opacity-75' : ''}">
							<td class="px-4 py-3">
								<span class="font-mono text-xs {rankBadge(row.rank)}">{row.rank}</span>
							</td>
							<td class="px-3 py-3 text-center">
								<span class="text-xs font-bold {deltaClass(row.delta)}">{deltaLabel(row.delta)}</span>
							</td>
							<td class="px-4 py-3">
								<div class="flex items-center gap-3">
									{#if row.avatar}
										<img src={row.avatar} alt="" class="w-8 h-8 rounded-full object-cover shrink-0 ring-1 ring-navy-700" />
									{:else}
										<div class="w-8 h-8 rounded-full bg-navy-800 flex items-center justify-center shrink-0 text-sm">🏈</div>
									{/if}
									<div>
										<p class="font-semibold text-white leading-tight">{row.teamName}</p>
										{#if row.ownerName && row.ownerName !== row.teamName}
											<p class="text-xs text-navy-500">{row.ownerName}</p>
										{/if}
									</div>
								</div>
							</td>
							<td class="px-4 py-3 text-center text-slate-400 tabular-nums text-xs">
								{row.wins}–{row.losses}{row.ties > 0 ? `–${row.ties}` : ''}
							</td>
							<td class="px-4 py-3 text-right font-mono text-xs text-slate-400 tabular-nums">
								{row.totalPF.toFixed(1)}
							</td>
							<td class="px-4 py-3 text-right">
								<span class="font-mono font-bold text-white tabular-nums">
									{row.score > 0 ? row.score.toFixed(2) : '—'}
								</span>
							</td>
							<td class="px-4 py-3 text-right tabular-nums {oddsClass(row.playoffOdds)}">
								{oddsLabel(row.playoffOdds, weeksRemainingFromHere === 0)}
							</td>
						</tr>
						<!-- Playoff cutline -->
						{#if atCutline && selectedWeek > 0 && weeksRemainingFromHere > 0}
							<tr class="border-t border-amber-500/40">
								<td colspan="99" class="px-4 py-1 bg-amber-500/5">
									<span class="text-xs text-amber-400/70 font-medium">— Playoff line —</span>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Mobile cards -->
		<div class="sm:hidden space-y-2">
			{#each rankings as row, i}
				{@const atCutline = playoffLine !== null && i === playoffLine && selectedWeek > 0 && weeksRemainingFromHere > 0}
				{#if atCutline}
					<div class="px-4 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
						<span class="text-xs text-amber-400/80 font-medium">— Playoff line —</span>
					</div>
				{/if}
				<div class="bg-navy-850 rounded-lg border border-navy-700 px-4 py-3
				            {row.rank === 1 ? 'border-amber-500/30 bg-amber-500/5' : ''}
				            {playoffLine !== null && i >= playoffLine ? 'opacity-75' : ''}">
					<div class="flex items-center gap-3">
						<!-- Rank + delta -->
						<div class="w-10 shrink-0 text-center">
							<p class="font-mono text-sm {rankBadge(row.rank)}">{row.rank}</p>
							<p class="text-xs {deltaClass(row.delta)}">{deltaLabel(row.delta)}</p>
						</div>

						{#if row.avatar}
							<img src={row.avatar} alt="" class="w-10 h-10 rounded-full object-cover shrink-0 ring-1 ring-navy-700" />
						{:else}
							<div class="w-10 h-10 rounded-full bg-navy-800 flex items-center justify-center shrink-0">🏈</div>
						{/if}

						<div class="flex-1 min-w-0">
							<p class="font-semibold text-white text-sm truncate">{row.teamName}</p>
							<p class="text-xs text-navy-500 tabular-nums">{row.wins}–{row.losses}{row.ties > 0 ? `–${row.ties}` : ''} · {row.totalPF.toFixed(1)} PF</p>
						</div>

						<div class="shrink-0 text-right">
							<p class="font-mono font-bold text-white text-sm tabular-nums">{row.score > 0 ? row.score.toFixed(2) : '—'}</p>
							<p class="text-xs {oddsClass(row.playoffOdds)}">{oddsLabel(row.playoffOdds, weeksRemainingFromHere === 0)}</p>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Legend -->
		{#if currentWeek > 0}
			<div class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-navy-500">
				<span>Score = (PF × 2) + (PF × H2H Win%) + (PF × Median Win%)</span>
				{#if selectedWeek > 0 && weeksRemainingFromHere > 0}
					<span>·</span>
					<span>Playoff % simulates {weeksRemainingFromHere} remaining wk{weeksRemainingFromHere !== 1 ? 's' : ''} using actual schedule · 100%/0% = clinched/eliminated</span>
				{/if}
			</div>
		{/if}
	{/if}
</div>
