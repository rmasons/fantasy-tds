<script lang="ts">
	import type { LayoutData } from '../$types';
	import type { SeasonRecords, RecordGame, RecordScore } from '$lib/types';
	import FaabEasterEgg from '$lib/components/FaabEasterEgg.svelte';

	let { data } = $props<{ data: LayoutData }>();

	// ─── Season tab state ────────────────────────────────────────────────────────
	let blowouts = $state<RecordGame[]>([]);
	let closest = $state<RecordGame[]>([]);
	let weekHighs = $state<RecordScore[]>([]);
	let weekLows = $state<RecordScore[]>([]);
	let highCombined = $state<RecordGame[]>([]);
	let seasonLeaders = $state<{ team: string; avatar: string | null; fpts: number }[]>([]);
	let season = $state('');
	let loading = $state(true);
	let error = $state('');

	// ─── All-time tab state ──────────────────────────────────────────────────────
	interface AllTimeStat {
		userId: string;
		displayName: string;
		avatar: string | null;
		wins: number;
		losses: number;
		ties: number;
		fpts: number;
		fptsAgainst: number;
		seasons: number;
	}

	let tab = $state<'season' | 'alltime'>('season');
	let atLoading = $state(false);
	let atLoaded = $state(false);
	let atStatus = $state('');
	let atError = $state('');
	let atManagers = $state<AllTimeStat[]>([]);
	let atBlowouts = $state<RecordGame[]>([]);
	let atClosest = $state<RecordGame[]>([]);
	let atHighs = $state<RecordScore[]>([]);
	let atLows = $state<RecordScore[]>([]);
	let atHighCombined = $state<RecordGame[]>([]);
	let atLowCombined = $state<RecordGame[]>([]);

	$effect(() => {
		const leagueId = data.leagueId;
		blowouts = [];
		closest = [];
		weekHighs = [];
		weekLows = [];
		highCombined = [];
		seasonLeaders = [];
		season = '';
		loading = true;
		error = '';
		tab = 'season';
		atLoaded = false;
		atLoading = false;
		atManagers = [];
		atBlowouts = [];
		atClosest = [];
		atHighs = [];
		atLows = [];
		atHighCombined = [];
		atLowCombined = [];
		atError = '';

		(async () => {
			try {
				const res = await fetch(`/api/records/${leagueId}`);
				if (!res.ok) throw new Error(`Failed to load records: ${res.status}`);
				const result = await res.json() as SeasonRecords;

				if (data.leagueId !== leagueId) return;

				season = result.season;

				seasonLeaders = result.rosterSummaries
					.map(r => ({ team: r.teamName, avatar: r.avatar, fpts: r.fpts }))
					.sort((a, b) => b.fpts - a.fpts);

				blowouts = [...result.gameResults].sort((a, b) => b.diff - a.diff).slice(0, 5);
				closest = [...result.gameResults].sort((a, b) => a.diff - b.diff).slice(0, 5);
				weekHighs = [...result.weekHighs].sort((a, b) => b.pts - a.pts).slice(0, 10);
				weekLows = [...result.weekLows].sort((a, b) => a.pts - b.pts).slice(0, 10);
				highCombined = [...result.gameResults].sort((a, b) => (b.winnerPts + b.loserPts) - (a.winnerPts + a.loserPts)).slice(0, 5);
			} catch (e: any) {
				if (data.leagueId !== leagueId) return;
				error = e.message;
			} finally {
				if (data.leagueId !== leagueId) return;
				loading = false;
			}
		})();
	});

	async function loadAllTime() {
		if (atLoaded || atLoading) return;
		atLoading = true;
		atError = '';
		const leagueId = data.leagueId;

		try {
			const managerMap = new Map<string, AllTimeStat>();
			const allGameResults: RecordGame[] = [];
			const allWeekHighs: RecordScore[] = [];
			const allWeekLows: RecordScore[] = [];

			let curId: string | null = leagueId;

			while (curId && curId !== '0') {
				const res = await fetch(`/api/records/${curId}`);
				if (!res.ok) throw new Error(`Failed to load season: ${res.status}`);
				const result = await res.json() as SeasonRecords;

				if (data.leagueId !== leagueId) return;

				atStatus = `Loading ${result.season}…`;

				for (const r of result.rosterSummaries) {
					const existing = managerMap.get(r.ownerId);
					if (existing) {
						existing.wins += r.wins;
						existing.losses += r.losses;
						existing.ties += r.ties;
						existing.fpts += r.fpts;
						existing.fptsAgainst += r.fptsAgainst;
						existing.seasons += 1;
					} else {
						managerMap.set(r.ownerId, {
							userId: r.ownerId,
							displayName: r.teamName ?? r.ownerName,
							avatar: r.avatar,
							wins: r.wins,
							losses: r.losses,
							ties: r.ties,
							fpts: r.fpts,
							fptsAgainst: r.fptsAgainst,
							seasons: 1,
						});
					}
				}

				allGameResults.push(...result.gameResults);
				allWeekHighs.push(...result.weekHighs);
				allWeekLows.push(...result.weekLows);

				// Reactively stream in results as each season finishes
				atManagers = Array.from(managerMap.values()).sort((a, b) => {
					const aG = a.wins + a.losses + a.ties;
					const bG = b.wins + b.losses + b.ties;
					const aPct = aG > 0 ? (a.wins + a.ties * 0.5) / aG : 0;
					const bPct = bG > 0 ? (b.wins + b.ties * 0.5) / bG : 0;
					return bPct - aPct;
				});
				atBlowouts = [...allGameResults].sort((a, b) => b.diff - a.diff).slice(0, 5);
				atClosest = [...allGameResults].sort((a, b) => a.diff - b.diff).slice(0, 5);
				atHighs = [...allWeekHighs].sort((a, b) => b.pts - a.pts).slice(0, 10);
				atLows = [...allWeekLows].sort((a, b) => a.pts - b.pts).slice(0, 10);
				atHighCombined = [...allGameResults].sort((a, b) => (b.winnerPts + b.loserPts) - (a.winnerPts + a.loserPts)).slice(0, 5);
				atLowCombined = [...allGameResults].sort((a, b) => (a.winnerPts + a.loserPts) - (b.winnerPts + b.loserPts)).slice(0, 5);

				curId = result.previousLeagueId;
			}

			if (data.leagueId !== leagueId) return;
			atLoaded = true;
		} catch (e: any) {
			if (data.leagueId !== leagueId) return;
			atError = e.message;
		} finally {
			if (data.leagueId !== leagueId) return;
			atLoading = false;
		}
	}

	function switchTab(t: 'season' | 'alltime') {
		tab = t;
		if (t === 'alltime') loadAllTime();
	}

	function winPct(m: AllTimeStat) {
		const g = m.wins + m.losses + m.ties;
		return g > 0 ? ((m.wins + m.ties * 0.5) / g * 100).toFixed(1) : '—';
	}

	function fptsPerGame(m: AllTimeStat) {
		const g = m.wins + m.losses + m.ties;
		return g > 0 ? (m.fpts / g).toFixed(2) : '—';
	}
</script>

<div>
	<!-- Page header -->
	<div class="mb-5">
		<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">Records</h1>
		<p class="text-navy-500 text-[10px] uppercase tracking-[0.2em] font-semibold mt-1">League Statistics</p>
	</div>

	<!-- Tab switcher -->
	<div class="flex mb-6 border-b border-navy-700">
		<button
			onclick={() => switchTab('season')}
			class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
			       {tab === 'season' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
		>
			{season || 'This Season'}
		</button>
		<button
			onclick={() => switchTab('alltime')}
			class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
			       {tab === 'alltime' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
		>
			All Time<FaabEasterEgg eggId="2" leagueId={data.leagueId} loggedIn={!!data.user} />
		</button>
	</div>

	<!-- ── Season tab ── -->
	{#if tab === 'season'}
		{#if loading}
			<div class="grid sm:grid-cols-2 gap-5">
				{#each Array(4) as _}
					<div class="h-48 bg-navy-850 rounded-lg animate-pulse"></div>
				{/each}
			</div>
		{:else if error}
			<p class="text-red-400">Failed to load records: {error}</p>
		{:else}
			<div class="grid sm:grid-cols-2 gap-5">

				<!-- Season PF Leaders -->
				<section class="bg-navy-850 border border-navy-700 rounded-lg overflow-hidden flex flex-col h-[460px]">
					<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 px-4 py-2.5 bg-navy-900 border-b border-navy-700 shrink-0 flex items-center gap-2">
						<span class="text-amber-400">◆</span> Points Leaders
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#each seasonLeaders.slice(0, 8) as team, i}
							<div class="flex-1 flex items-center gap-3 px-4 {i % 2 !== 0 ? 'bg-navy-875' : ''} border-b border-navy-700/40 last:border-0">
								<span class="text-navy-600 font-mono text-xs w-4 text-right shrink-0">{i + 1}</span>
								{#if team.avatar}
									<img src={team.avatar} alt="" class="w-7 h-7 rounded-full object-cover shrink-0 ring-1 ring-navy-700" />
								{:else}
									<div class="w-7 h-7 rounded-full bg-navy-700 shrink-0"></div>
								{/if}
								<span class="text-sm text-slate-200 flex-1 truncate">{team.team}</span>
								<span class="font-mono text-sm font-bold text-white tabular-nums">{team.fpts.toFixed(2)}</span>
							</div>
						{/each}
					</div>
				</section>

				<!-- Biggest Blowouts -->
				<section class="bg-navy-850 border border-navy-700 rounded-lg overflow-hidden flex flex-col h-[460px]">
					<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 px-4 py-2.5 bg-navy-900 border-b border-navy-700 shrink-0 flex items-center gap-2">
						<span class="text-amber-400">◆</span> Biggest Blowouts
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if blowouts.length === 0}
							<p class="px-4 py-3 text-sm text-navy-500">No completed games yet.</p>
						{:else}
							{#each blowouts as g, i}
								<div class="flex-1 flex flex-col justify-center px-4 {i % 2 !== 0 ? 'bg-navy-875' : ''} border-b border-navy-700/40 last:border-0">
									<div class="flex items-baseline justify-between">
										<span class="text-sm font-semibold text-white truncate flex-1">{g.winner}</span>
										<span class="font-mono text-sm font-bold text-white ml-3 shrink-0 tabular-nums">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex items-baseline justify-between">
										<span class="text-sm text-navy-400 truncate flex-1">{g.loser}</span>
										<span class="font-mono text-sm text-navy-400 ml-3 shrink-0 tabular-nums">{g.loserPts.toFixed(2)}</span>
									</div>
									<div class="flex items-center gap-2 mt-0.5">
										<span class="text-[10px] text-navy-600 font-medium uppercase tracking-wider">Wk {g.week}</span>
										<span class="text-[10px] font-bold text-amber-400">+{g.diff}</span>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- Weekly Highs -->
				<section class="bg-navy-850 border border-navy-700 rounded-lg overflow-hidden flex flex-col h-[460px]">
					<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 px-4 py-2.5 bg-navy-900 border-b border-navy-700 shrink-0 flex items-center gap-2">
						<span class="text-amber-400">◆</span> High Scores
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if weekHighs.length === 0}
							<p class="px-4 py-3 text-sm text-navy-500">No completed games yet.</p>
						{:else}
							{#each weekHighs as h, i}
								<div class="flex-1 flex items-center gap-3 px-4 {i % 2 !== 0 ? 'bg-navy-875' : ''} border-b border-navy-700/40 last:border-0">
									<span class="text-navy-600 font-mono text-xs w-4 text-right shrink-0">{i + 1}</span>
									<span class="text-sm text-slate-200 flex-1 truncate">{h.team}</span>
									<span class="text-[10px] text-navy-600 font-medium uppercase tracking-wider shrink-0">Wk {h.week}</span>
									<span class="font-mono text-sm font-bold text-green-400 ml-1 tabular-nums shrink-0">{h.pts.toFixed(2)}</span>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- Closest Games -->
				<section class="bg-navy-850 border border-navy-700 rounded-lg overflow-hidden flex flex-col h-[460px]">
					<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 px-4 py-2.5 bg-navy-900 border-b border-navy-700 shrink-0 flex items-center gap-2">
						<span class="text-amber-400">◆</span> Closest Games
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if closest.length === 0}
							<p class="px-4 py-3 text-sm text-navy-500">No completed games yet.</p>
						{:else}
							{#each closest as g, i}
								<div class="flex-1 flex flex-col justify-center px-4 {i % 2 !== 0 ? 'bg-navy-875' : ''} border-b border-navy-700/40 last:border-0">
									<div class="flex items-baseline justify-between">
										<span class="text-sm font-semibold text-white truncate flex-1">{g.winner}</span>
										<span class="font-mono text-sm font-bold text-white ml-3 shrink-0 tabular-nums">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex items-baseline justify-between">
										<span class="text-sm text-navy-400 truncate flex-1">{g.loser}</span>
										<span class="font-mono text-sm text-navy-400 ml-3 shrink-0 tabular-nums">{g.loserPts.toFixed(2)}</span>
									</div>
									<div class="flex items-center gap-2 mt-0.5">
										<span class="text-[10px] text-navy-600 font-medium uppercase tracking-wider">Wk {g.week}</span>
										<span class="text-[10px] font-bold text-sky-400">&#916; {g.diff}</span>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- Weekly Lows -->
				<section class="bg-navy-850 border border-navy-700 rounded-lg overflow-hidden flex flex-col h-[460px]">
					<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 px-4 py-2.5 bg-navy-900 border-b border-navy-700 shrink-0 flex items-center gap-2">
						<span class="text-amber-400">◆</span> Low Scores
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if weekLows.length === 0}
							<p class="px-4 py-3 text-sm text-navy-500">No completed games yet.</p>
						{:else}
							{#each weekLows as h, i}
								<div class="flex-1 flex items-center gap-3 px-4 {i % 2 !== 0 ? 'bg-navy-875' : ''} border-b border-navy-700/40 last:border-0">
									<span class="text-navy-600 font-mono text-xs w-4 text-right shrink-0">{i + 1}</span>
									<span class="text-sm text-slate-200 flex-1 truncate">{h.team}</span>
									<span class="text-[10px] text-navy-600 font-medium uppercase tracking-wider shrink-0">Wk {h.week}</span>
									<span class="font-mono text-sm font-bold text-red-400 ml-1 tabular-nums shrink-0">{h.pts.toFixed(2)}</span>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- Highest Scoring Matchups -->
				<section class="bg-navy-850 border border-navy-700 rounded-lg overflow-hidden flex flex-col h-[460px]">
					<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 px-4 py-2.5 bg-navy-900 border-b border-navy-700 shrink-0 flex items-center gap-2">
						<span class="text-amber-400">◆</span> Highest Scoring Matchups
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if highCombined.length === 0}
							<p class="px-4 py-3 text-sm text-navy-500">No completed games yet.</p>
						{:else}
							{#each highCombined as g, i}
								<div class="flex-1 flex flex-col justify-center px-4 {i % 2 !== 0 ? 'bg-navy-875' : ''} border-b border-navy-700/40 last:border-0">
									<div class="flex items-baseline justify-between">
										<span class="text-sm font-semibold text-white truncate flex-1">{g.winner}</span>
										<span class="font-mono text-sm font-bold text-white ml-3 shrink-0 tabular-nums">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex items-baseline justify-between">
										<span class="text-sm text-navy-400 truncate flex-1">{g.loser}</span>
										<span class="font-mono text-sm text-navy-400 ml-3 shrink-0 tabular-nums">{g.loserPts.toFixed(2)}</span>
									</div>
									<div class="flex items-center gap-2 mt-0.5">
										<span class="text-[10px] text-navy-600 font-medium uppercase tracking-wider">Wk {g.week}</span>
										<span class="text-[10px] font-bold text-amber-400/70">{(g.winnerPts + g.loserPts).toFixed(2)} combined</span>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</section>

			</div>
		{/if}
	{/if}

	<!-- ── All-time tab ── -->
	{#if tab === 'alltime'}
		{#if atError}
			<p class="text-red-400">Failed to load all-time records: {atError}</p>
		{:else}
			<!-- All-time standings table -->
			<section class="bg-navy-850 border border-navy-700 rounded-lg overflow-hidden mb-6">
				<div class="flex items-center justify-between px-4 py-2.5 bg-navy-900 border-b border-navy-700">
					<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 flex items-center gap-2">
						<span class="text-amber-400">◆</span> All-Time Standings
					</h2>
					{#if atLoading}
						<span class="text-[10px] text-navy-500 uppercase tracking-wider animate-pulse">{atStatus}</span>
					{/if}
				</div>
				{#if atManagers.length === 0 && atLoading}
					<div class="h-48 animate-pulse bg-navy-875"></div>
				{:else if atManagers.length === 0}
					<p class="px-4 py-3 text-sm text-navy-500">No history found.</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b border-navy-700 text-navy-500 text-[10px] uppercase tracking-wider">
									<th class="px-4 py-3 text-left font-semibold">Manager</th>
									<th class="px-3 py-3 text-right font-semibold">W–L</th>
									<th class="px-3 py-3 text-right font-semibold">Win%</th>
									<th class="px-3 py-3 text-right font-semibold">PF</th>
									<th class="px-3 py-3 text-right font-semibold hidden sm:table-cell">PF/G</th>
									<th class="px-3 py-3 text-right font-semibold hidden md:table-cell">PA</th>
									<th class="px-3 py-3 text-right font-semibold hidden md:table-cell">Yrs</th>
								</tr>
							</thead>
							<tbody>
								{#each atManagers as m, i}
									<tr class="border-b border-navy-700/50 {i % 2 !== 0 ? 'bg-navy-875' : ''} hover:bg-navy-800 transition-colors">
										<td class="px-4 py-2.5">
											<div class="flex items-center gap-2">
												<span class="text-navy-600 font-mono text-xs w-4 shrink-0">{i + 1}</span>
												{#if m.avatar}
													<img src={m.avatar} alt="" class="w-6 h-6 rounded-full object-cover shrink-0 ring-1 ring-navy-700" />
												{:else}
													<div class="w-6 h-6 rounded-full bg-navy-700 shrink-0"></div>
												{/if}
												<span class="text-slate-200 truncate max-w-[120px]">{m.displayName}</span>
											</div>
										</td>
										<td class="px-3 py-2.5 text-right font-mono text-slate-300 whitespace-nowrap tabular-nums">
											{m.wins}–{m.losses}{m.ties ? `–${m.ties}` : ''}
										</td>
										<td class="px-3 py-2.5 text-right text-slate-400 tabular-nums">{winPct(m)}%</td>
										<td class="px-3 py-2.5 text-right font-mono text-white font-semibold tabular-nums">{m.fpts.toFixed(0)}</td>
										<td class="px-3 py-2.5 text-right text-slate-500 hidden sm:table-cell tabular-nums">{fptsPerGame(m)}</td>
										<td class="px-3 py-2.5 text-right text-navy-500 hidden md:table-cell tabular-nums">{m.fptsAgainst.toFixed(0)}</td>
										<td class="px-3 py-2.5 text-right text-navy-500 hidden md:table-cell">{m.seasons}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					{#if atLoading}
						<p class="px-4 py-2 text-[10px] text-navy-500 uppercase tracking-wider animate-pulse border-t border-navy-700">{atStatus}</p>
					{/if}
				{/if}
			</section>

			<!-- All-time game records -->
			<div class="grid sm:grid-cols-2 gap-5">

				<!-- All-time weekly highs -->
				<section class="bg-navy-850 border border-navy-700 rounded-lg overflow-hidden flex flex-col h-[460px]">
					<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 px-4 py-2.5 bg-navy-900 border-b border-navy-700 shrink-0 flex items-center gap-2">
						<span class="text-amber-400">◆</span> All-Time High Scores
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if atHighs.length === 0 && atLoading}
							<div class="h-32 animate-pulse bg-navy-875"></div>
						{:else if atHighs.length === 0}
							<p class="px-4 py-3 text-sm text-navy-500">No data yet.</p>
						{:else}
							{#each atHighs as h, i}
								<div class="flex-1 flex items-center gap-3 px-4 {i % 2 !== 0 ? 'bg-navy-875' : ''} border-b border-navy-700/40 last:border-0">
									<span class="text-navy-600 font-mono text-xs w-4 text-right shrink-0">{i + 1}</span>
									<span class="text-sm text-slate-200 flex-1 truncate">{h.team}</span>
									<span class="text-[10px] text-navy-600 font-medium uppercase tracking-wider shrink-0">{h.season} Wk{h.week}</span>
									<span class="font-mono text-sm font-bold text-green-400 ml-1 tabular-nums shrink-0">{h.pts.toFixed(2)}</span>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- All-time blowouts -->
				<section class="bg-navy-850 border border-navy-700 rounded-lg overflow-hidden flex flex-col h-[460px]">
					<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 px-4 py-2.5 bg-navy-900 border-b border-navy-700 shrink-0 flex items-center gap-2">
						<span class="text-amber-400">◆</span> All-Time Blowouts
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if atBlowouts.length === 0 && atLoading}
							<div class="h-32 animate-pulse bg-navy-875"></div>
						{:else if atBlowouts.length === 0}
							<p class="px-4 py-3 text-sm text-navy-500">No data yet.</p>
						{:else}
							{#each atBlowouts as g, i}
								<div class="flex-1 flex flex-col justify-center px-4 {i % 2 !== 0 ? 'bg-navy-875' : ''} border-b border-navy-700/40 last:border-0">
									<div class="flex items-baseline justify-between">
										<span class="text-sm font-semibold text-white truncate flex-1">{g.winner}</span>
										<span class="font-mono text-sm font-bold text-white ml-3 shrink-0 tabular-nums">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex items-baseline justify-between">
										<span class="text-sm text-navy-400 truncate flex-1">{g.loser}</span>
										<span class="font-mono text-sm text-navy-400 ml-3 shrink-0 tabular-nums">{g.loserPts.toFixed(2)}</span>
									</div>
									<div class="flex items-center gap-2 mt-0.5">
										<span class="text-[10px] text-navy-600 font-medium uppercase tracking-wider">{g.season} Wk{g.week}</span>
										<span class="text-[10px] font-bold text-amber-400">+{g.diff}</span>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- All-time closest games -->
				<section class="bg-navy-850 border border-navy-700 rounded-lg overflow-hidden flex flex-col h-[460px]">
					<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 px-4 py-2.5 bg-navy-900 border-b border-navy-700 shrink-0 flex items-center gap-2">
						<span class="text-amber-400">◆</span> All-Time Closest Games
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if atClosest.length === 0 && atLoading}
							<div class="h-32 animate-pulse bg-navy-875"></div>
						{:else if atClosest.length === 0}
							<p class="px-4 py-3 text-sm text-navy-500">No data yet.</p>
						{:else}
							{#each atClosest as g, i}
								<div class="flex-1 flex flex-col justify-center px-4 {i % 2 !== 0 ? 'bg-navy-875' : ''} border-b border-navy-700/40 last:border-0">
									<div class="flex items-baseline justify-between">
										<span class="text-sm font-semibold text-white truncate flex-1">{g.winner}</span>
										<span class="font-mono text-sm font-bold text-white ml-3 shrink-0 tabular-nums">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex items-baseline justify-between">
										<span class="text-sm text-navy-400 truncate flex-1">{g.loser}</span>
										<span class="font-mono text-sm text-navy-400 ml-3 shrink-0 tabular-nums">{g.loserPts.toFixed(2)}</span>
									</div>
									<div class="flex items-center gap-2 mt-0.5">
										<span class="text-[10px] text-navy-600 font-medium uppercase tracking-wider">{g.season} Wk{g.week}</span>
										<span class="text-[10px] font-bold text-sky-400">&#916; {g.diff}</span>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- All-time weekly lows -->
				<section class="bg-navy-850 border border-navy-700 rounded-lg overflow-hidden flex flex-col h-[460px]">
					<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 px-4 py-2.5 bg-navy-900 border-b border-navy-700 shrink-0 flex items-center gap-2">
						<span class="text-amber-400">◆</span> All-Time Low Scores
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if atLows.length === 0 && atLoading}
							<div class="h-32 animate-pulse bg-navy-875"></div>
						{:else if atLows.length === 0}
							<p class="px-4 py-3 text-sm text-navy-500">No data yet.</p>
						{:else}
							{#each atLows as h, i}
								<div class="flex-1 flex items-center gap-3 px-4 {i % 2 !== 0 ? 'bg-navy-875' : ''} border-b border-navy-700/40 last:border-0">
									<span class="text-navy-600 font-mono text-xs w-4 text-right shrink-0">{i + 1}</span>
									<span class="text-sm text-slate-200 flex-1 truncate">{h.team}</span>
									<span class="text-[10px] text-navy-600 font-medium uppercase tracking-wider shrink-0">{h.season} Wk{h.week}</span>
									<span class="font-mono text-sm font-bold text-red-400 ml-1 tabular-nums shrink-0">{h.pts.toFixed(2)}</span>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- All-time highest scoring matchups -->
				<section class="bg-navy-850 border border-navy-700 rounded-lg overflow-hidden flex flex-col h-[460px]">
					<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 px-4 py-2.5 bg-navy-900 border-b border-navy-700 shrink-0 flex items-center gap-2">
						<span class="text-amber-400">◆</span> All-Time Highest Scoring Matchups
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if atHighCombined.length === 0 && atLoading}
							<div class="h-32 animate-pulse bg-navy-875"></div>
						{:else if atHighCombined.length === 0}
							<p class="px-4 py-3 text-sm text-navy-500">No data yet.</p>
						{:else}
							{#each atHighCombined as g, i}
								<div class="flex-1 flex flex-col justify-center px-4 {i % 2 !== 0 ? 'bg-navy-875' : ''} border-b border-navy-700/40 last:border-0">
									<div class="flex items-baseline justify-between">
										<span class="text-sm font-semibold text-white truncate flex-1">{g.winner}</span>
										<span class="font-mono text-sm font-bold text-white ml-3 shrink-0 tabular-nums">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex items-baseline justify-between">
										<span class="text-sm text-navy-400 truncate flex-1">{g.loser}</span>
										<span class="font-mono text-sm text-navy-400 ml-3 shrink-0 tabular-nums">{g.loserPts.toFixed(2)}</span>
									</div>
									<div class="flex items-center gap-2 mt-0.5">
										<span class="text-[10px] text-navy-600 font-medium uppercase tracking-wider">{g.season} Wk{g.week}</span>
										<span class="text-[10px] font-bold text-amber-400/70">{(g.winnerPts + g.loserPts).toFixed(2)} combined</span>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- All-time lowest scoring matchups -->
				<section class="bg-navy-850 border border-navy-700 rounded-lg overflow-hidden flex flex-col h-[460px]">
					<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 px-4 py-2.5 bg-navy-900 border-b border-navy-700 shrink-0 flex items-center gap-2">
						<span class="text-amber-400">◆</span> All-Time Lowest Scoring Matchups
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if atLowCombined.length === 0 && atLoading}
							<div class="h-32 animate-pulse bg-navy-875"></div>
						{:else if atLowCombined.length === 0}
							<p class="px-4 py-3 text-sm text-navy-500">No data yet.</p>
						{:else}
							{#each atLowCombined as g, i}
								<div class="flex-1 flex flex-col justify-center px-4 {i % 2 !== 0 ? 'bg-navy-875' : ''} border-b border-navy-700/40 last:border-0">
									<div class="flex items-baseline justify-between">
										<span class="text-sm font-semibold text-white truncate flex-1">{g.winner}</span>
										<span class="font-mono text-sm font-bold text-white ml-3 shrink-0 tabular-nums">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex items-baseline justify-between">
										<span class="text-sm text-navy-400 truncate flex-1">{g.loser}</span>
										<span class="font-mono text-sm text-navy-400 ml-3 shrink-0 tabular-nums">{g.loserPts.toFixed(2)}</span>
									</div>
									<div class="flex items-center gap-2 mt-0.5">
										<span class="text-[10px] text-navy-600 font-medium uppercase tracking-wider">{g.season} Wk{g.week}</span>
										<span class="text-[10px] text-slate-500">{(g.winnerPts + g.loserPts).toFixed(2)} combined</span>
									</div>
								</div>
							{/each}
						{/if}
					</div>
				</section>

			</div>
		{/if}
	{/if}
</div>
