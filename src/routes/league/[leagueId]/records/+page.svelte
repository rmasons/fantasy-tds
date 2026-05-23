<script lang="ts">
	import type { LayoutData } from '../$types';
	import type { SeasonRecords, RecordGame, RecordScore } from '$lib/types';

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
							displayName: r.ownerName ?? r.teamName,
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
	<h1 class="text-2xl font-bold mb-4">Records</h1>

	<!-- Tab switcher -->
	<div class="flex gap-1 mb-6 bg-slate-800/50 rounded-lg p-1 w-fit">
		<button
			onclick={() => switchTab('season')}
			class="px-4 py-1.5 rounded-md text-sm font-medium transition-colors
			       {tab === 'season' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}"
		>
			{season || 'This Season'}
		</button>
		<button
			onclick={() => switchTab('alltime')}
			class="px-4 py-1.5 rounded-md text-sm font-medium transition-colors
			       {tab === 'alltime' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}"
		>
			All Time
		</button>
	</div>

	<!-- ── Season tab ──────────────────────────────────────────────────────────── -->
	{#if tab === 'season'}
		{#if loading}
			<div class="grid sm:grid-cols-2 gap-6">
				{#each Array(4) as _}
					<div class="h-48 bg-slate-800 rounded-xl animate-pulse"></div>
				{/each}
			</div>
		{:else if error}
			<p class="text-red-400">Failed to load records: {error}</p>
		{:else}
			<div class="grid sm:grid-cols-2 gap-6">

				<!-- Season PF Leaders -->
				<section class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col h-[460px]">
					<h2 class="px-4 py-3 text-sm font-semibold text-slate-300 border-b border-slate-800 bg-slate-800/40 shrink-0">
						🏆 Season Points Leaders
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#each seasonLeaders.slice(0, 8) as team, i}
							<div class="flex-1 flex items-center gap-3 px-4 {i % 2 === 0 ? '' : 'bg-slate-800/30'}">
								<span class="text-slate-600 text-xs w-4">{i + 1}</span>
								{#if team.avatar}
									<img src={team.avatar} alt="" class="w-7 h-7 rounded-full object-cover shrink-0" />
								{:else}
									<div class="w-7 h-7 rounded-full bg-slate-700 shrink-0"></div>
								{/if}
								<span class="text-sm text-slate-200 flex-1 truncate">{team.team}</span>
								<span class="font-mono text-sm font-semibold text-white">{team.fpts.toFixed(2)}</span>
							</div>
						{/each}
					</div>
				</section>

				<!-- Biggest Blowouts -->
				<section class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col h-[460px]">
					<h2 class="px-4 py-3 text-sm font-semibold text-slate-300 border-b border-slate-800 bg-slate-800/40 shrink-0">
						💥 Biggest Blowouts
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if blowouts.length === 0}
							<p class="px-4 py-3 text-sm text-slate-500">No completed games yet.</p>
						{:else}
							{#each blowouts as g, i}
								<div class="flex-1 flex flex-col justify-center px-4 {i % 2 === 0 ? '' : 'bg-slate-800/30'}">
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-white font-medium truncate">{g.winner}</span>
										<span class="font-mono text-white ml-2 shrink-0">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-slate-400 truncate">{g.loser}</span>
										<span class="font-mono text-slate-400 ml-2 shrink-0">{g.loserPts.toFixed(2)}</span>
									</div>
									<p class="text-xs text-slate-600 mt-0.5">Week {g.week} · margin: <span class="text-orange-400">{g.diff}</span></p>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- Weekly Highs -->
				<section class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col h-[460px]">
					<h2 class="px-4 py-3 text-sm font-semibold text-slate-300 border-b border-slate-800 bg-slate-800/40 shrink-0">
						🔥 Highest Single-Week Scores
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if weekHighs.length === 0}
							<p class="px-4 py-3 text-sm text-slate-500">No completed games yet.</p>
						{:else}
							{#each weekHighs as h, i}
								<div class="flex-1 flex items-center gap-3 px-4 {i % 2 === 0 ? '' : 'bg-slate-800/30'}">
									<span class="text-slate-600 text-xs w-4">{i + 1}</span>
									<span class="text-sm text-slate-200 flex-1 truncate">{h.team}</span>
									<span class="text-xs text-slate-500 shrink-0">Wk {h.week}</span>
									<span class="font-mono text-sm font-semibold text-green-400 ml-2">{h.pts.toFixed(2)}</span>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- Closest Games -->
				<section class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col h-[460px]">
					<h2 class="px-4 py-3 text-sm font-semibold text-slate-300 border-b border-slate-800 bg-slate-800/40 shrink-0">
						🤏 Closest Games
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if closest.length === 0}
							<p class="px-4 py-3 text-sm text-slate-500">No completed games yet.</p>
						{:else}
							{#each closest as g, i}
								<div class="flex-1 flex flex-col justify-center px-4 {i % 2 === 0 ? '' : 'bg-slate-800/30'}">
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-white font-medium truncate">{g.winner}</span>
										<span class="font-mono text-white ml-2 shrink-0">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-slate-400 truncate">{g.loser}</span>
										<span class="font-mono text-slate-400 ml-2 shrink-0">{g.loserPts.toFixed(2)}</span>
									</div>
									<p class="text-xs text-slate-600 mt-0.5">Week {g.week} · margin: <span class="text-blue-400">{g.diff}</span></p>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- Weekly Lows -->
				<section class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col h-[460px]">
					<h2 class="px-4 py-3 text-sm font-semibold text-slate-300 border-b border-slate-800 bg-slate-800/40 shrink-0">
						🥶 Lowest Single-Week Scores
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if weekLows.length === 0}
							<p class="px-4 py-3 text-sm text-slate-500">No completed games yet.</p>
						{:else}
							{#each weekLows as h, i}
								<div class="flex-1 flex items-center gap-3 px-4 {i % 2 === 0 ? '' : 'bg-slate-800/30'}">
									<span class="text-slate-600 text-xs w-4">{i + 1}</span>
									<span class="text-sm text-slate-200 flex-1 truncate">{h.team}</span>
									<span class="text-xs text-slate-500 shrink-0">Wk {h.week}</span>
									<span class="font-mono text-sm font-semibold text-red-400 ml-2">{h.pts.toFixed(2)}</span>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- Highest Scoring Matchups -->
				<section class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col h-[460px]">
					<h2 class="px-4 py-3 text-sm font-semibold text-slate-300 border-b border-slate-800 bg-slate-800/40 shrink-0">
						📈 Highest Scoring Matchups
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if highCombined.length === 0}
							<p class="px-4 py-3 text-sm text-slate-500">No completed games yet.</p>
						{:else}
							{#each highCombined as g, i}
								<div class="flex-1 flex flex-col justify-center px-4 {i % 2 === 0 ? '' : 'bg-slate-800/30'}">
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-white font-medium truncate">{g.winner}</span>
										<span class="font-mono text-white ml-2 shrink-0">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-slate-400 truncate">{g.loser}</span>
										<span class="font-mono text-slate-400 ml-2 shrink-0">{g.loserPts.toFixed(2)}</span>
									</div>
									<p class="text-xs text-slate-600 mt-0.5">Week {g.week} · combined: <span class="text-purple-400">{(g.winnerPts + g.loserPts).toFixed(2)}</span></p>
								</div>
							{/each}
						{/if}
					</div>
				</section>

			</div>
		{/if}
	{/if}

	<!-- ── All-time tab ────────────────────────────────────────────────────────── -->
	{#if tab === 'alltime'}
		{#if atError}
			<p class="text-red-400">Failed to load all-time records: {atError}</p>
		{:else}
			<!-- All-time standings table -->
			<section class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden mb-6">
				<div class="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-800/40">
					<h2 class="text-sm font-semibold text-slate-300">📊 All-Time Standings</h2>
					{#if atLoading}
						<span class="text-xs text-slate-500 animate-pulse">{atStatus}</span>
					{/if}
				</div>
				{#if atManagers.length === 0 && atLoading}
					<div class="h-48 animate-pulse bg-slate-800/30"></div>
				{:else if atManagers.length === 0}
					<p class="px-4 py-3 text-sm text-slate-500">No history found.</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b border-slate-800 text-slate-500 text-xs uppercase">
									<th class="px-4 py-3 text-left">Manager</th>
									<th class="px-3 py-3 text-right">W–L</th>
									<th class="px-3 py-3 text-right">Win%</th>
									<th class="px-3 py-3 text-right">PF</th>
									<th class="px-3 py-3 text-right hidden sm:table-cell">PF/G</th>
									<th class="px-3 py-3 text-right hidden md:table-cell">PA</th>
									<th class="px-3 py-3 text-right hidden md:table-cell">Yrs</th>
								</tr>
							</thead>
							<tbody>
								{#each atManagers as m, i}
									<tr class="border-b border-slate-800/50 hover:bg-slate-800/30">
										<td class="px-4 py-2.5">
											<div class="flex items-center gap-2">
												<span class="text-slate-600 text-xs w-4 shrink-0">{i + 1}</span>
												{#if m.avatar}
													<img src={m.avatar} alt="" class="w-6 h-6 rounded-full object-cover shrink-0" />
												{:else}
													<div class="w-6 h-6 rounded-full bg-slate-700 shrink-0"></div>
												{/if}
												<span class="text-slate-200 truncate max-w-[120px]">{m.displayName}</span>
											</div>
										</td>
										<td class="px-3 py-2.5 text-right font-mono text-slate-300 whitespace-nowrap">
											{m.wins}–{m.losses}{m.ties ? `–${m.ties}` : ''}
										</td>
										<td class="px-3 py-2.5 text-right text-slate-400">{winPct(m)}%</td>
										<td class="px-3 py-2.5 text-right font-mono text-slate-300">{m.fpts.toFixed(0)}</td>
										<td class="px-3 py-2.5 text-right text-slate-500 hidden sm:table-cell">{fptsPerGame(m)}</td>
										<td class="px-3 py-2.5 text-right text-slate-600 hidden md:table-cell">{m.fptsAgainst.toFixed(0)}</td>
										<td class="px-3 py-2.5 text-right text-slate-600 hidden md:table-cell">{m.seasons}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					{#if atLoading}
						<p class="px-4 py-2 text-xs text-slate-600 animate-pulse border-t border-slate-800">{atStatus}</p>
					{/if}
				{/if}
			</section>

			<!-- All-time game records -->
			<div class="grid sm:grid-cols-2 gap-6">

				<!-- All-time weekly highs -->
				<section class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col h-[460px]">
					<h2 class="px-4 py-3 text-sm font-semibold text-slate-300 border-b border-slate-800 bg-slate-800/40 shrink-0">
						🔥 All-Time High Scores
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if atHighs.length === 0 && atLoading}
							<div class="h-32 animate-pulse bg-slate-800/30"></div>
						{:else if atHighs.length === 0}
							<p class="px-4 py-3 text-sm text-slate-500">No data yet.</p>
						{:else}
							{#each atHighs as h, i}
								<div class="flex-1 flex items-center gap-3 px-4 {i % 2 === 0 ? '' : 'bg-slate-800/30'}">
									<span class="text-slate-600 text-xs w-4">{i + 1}</span>
									<span class="text-sm text-slate-200 flex-1 truncate">{h.team}</span>
									<span class="text-xs text-slate-500 shrink-0">{h.season} Wk{h.week}</span>
									<span class="font-mono text-sm font-semibold text-green-400 ml-1">{h.pts.toFixed(2)}</span>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- All-time blowouts -->
				<section class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col h-[460px]">
					<h2 class="px-4 py-3 text-sm font-semibold text-slate-300 border-b border-slate-800 bg-slate-800/40 shrink-0">
						💥 All-Time Blowouts
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if atBlowouts.length === 0 && atLoading}
							<div class="h-32 animate-pulse bg-slate-800/30"></div>
						{:else if atBlowouts.length === 0}
							<p class="px-4 py-3 text-sm text-slate-500">No data yet.</p>
						{:else}
							{#each atBlowouts as g, i}
								<div class="flex-1 flex flex-col justify-center px-4 {i % 2 === 0 ? '' : 'bg-slate-800/30'}">
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-white font-medium truncate">{g.winner}</span>
										<span class="font-mono text-white ml-2 shrink-0">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-slate-400 truncate">{g.loser}</span>
										<span class="font-mono text-slate-400 ml-2 shrink-0">{g.loserPts.toFixed(2)}</span>
									</div>
									<p class="text-xs text-slate-600 mt-0.5">{g.season} Wk{g.week} · <span class="text-orange-400">{g.diff}</span></p>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- All-time closest games -->
				<section class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col h-[460px]">
					<h2 class="px-4 py-3 text-sm font-semibold text-slate-300 border-b border-slate-800 bg-slate-800/40 shrink-0">
						🤏 All-Time Closest Games
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if atClosest.length === 0 && atLoading}
							<div class="h-32 animate-pulse bg-slate-800/30"></div>
						{:else if atClosest.length === 0}
							<p class="px-4 py-3 text-sm text-slate-500">No data yet.</p>
						{:else}
							{#each atClosest as g, i}
								<div class="flex-1 flex flex-col justify-center px-4 {i % 2 === 0 ? '' : 'bg-slate-800/30'}">
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-white font-medium truncate">{g.winner}</span>
										<span class="font-mono text-white ml-2 shrink-0">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-slate-400 truncate">{g.loser}</span>
										<span class="font-mono text-slate-400 ml-2 shrink-0">{g.loserPts.toFixed(2)}</span>
									</div>
									<p class="text-xs text-slate-600 mt-0.5">{g.season} Wk{g.week} · <span class="text-blue-400">{g.diff}</span></p>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- All-time weekly lows -->
				<section class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col h-[460px]">
					<h2 class="px-4 py-3 text-sm font-semibold text-slate-300 border-b border-slate-800 bg-slate-800/40 shrink-0">
						🥶 All-Time Low Scores
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if atLows.length === 0 && atLoading}
							<div class="h-32 animate-pulse bg-slate-800/30"></div>
						{:else if atLows.length === 0}
							<p class="px-4 py-3 text-sm text-slate-500">No data yet.</p>
						{:else}
							{#each atLows as h, i}
								<div class="flex-1 flex items-center gap-3 px-4 {i % 2 === 0 ? '' : 'bg-slate-800/30'}">
									<span class="text-slate-600 text-xs w-4">{i + 1}</span>
									<span class="text-sm text-slate-200 flex-1 truncate">{h.team}</span>
									<span class="text-xs text-slate-500 shrink-0">{h.season} Wk{h.week}</span>
									<span class="font-mono text-sm font-semibold text-red-400 ml-1">{h.pts.toFixed(2)}</span>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- All-time highest scoring matchups -->
				<section class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col h-[460px]">
					<h2 class="px-4 py-3 text-sm font-semibold text-slate-300 border-b border-slate-800 bg-slate-800/40 shrink-0">
						📈 All-Time Highest Scoring Matchups
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if atHighCombined.length === 0 && atLoading}
							<div class="h-32 animate-pulse bg-slate-800/30"></div>
						{:else if atHighCombined.length === 0}
							<p class="px-4 py-3 text-sm text-slate-500">No data yet.</p>
						{:else}
							{#each atHighCombined as g, i}
								<div class="flex-1 flex flex-col justify-center px-4 {i % 2 === 0 ? '' : 'bg-slate-800/30'}">
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-white font-medium truncate">{g.winner}</span>
										<span class="font-mono text-white ml-2 shrink-0">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-slate-400 truncate">{g.loser}</span>
										<span class="font-mono text-slate-400 ml-2 shrink-0">{g.loserPts.toFixed(2)}</span>
									</div>
									<p class="text-xs text-slate-600 mt-0.5">{g.season} Wk{g.week} · combined: <span class="text-purple-400">{(g.winnerPts + g.loserPts).toFixed(2)}</span></p>
								</div>
							{/each}
						{/if}
					</div>
				</section>

				<!-- All-time lowest scoring matchups -->
				<section class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden flex flex-col h-[460px]">
					<h2 class="px-4 py-3 text-sm font-semibold text-slate-300 border-b border-slate-800 bg-slate-800/40 shrink-0">
						🧊 All-Time Lowest Scoring Matchups
					</h2>
					<div class="flex-1 flex flex-col min-h-0">
						{#if atLowCombined.length === 0 && atLoading}
							<div class="h-32 animate-pulse bg-slate-800/30"></div>
						{:else if atLowCombined.length === 0}
							<p class="px-4 py-3 text-sm text-slate-500">No data yet.</p>
						{:else}
							{#each atLowCombined as g, i}
								<div class="flex-1 flex flex-col justify-center px-4 {i % 2 === 0 ? '' : 'bg-slate-800/30'}">
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-white font-medium truncate">{g.winner}</span>
										<span class="font-mono text-white ml-2 shrink-0">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-slate-400 truncate">{g.loser}</span>
										<span class="font-mono text-slate-400 ml-2 shrink-0">{g.loserPts.toFixed(2)}</span>
									</div>
									<p class="text-xs text-slate-600 mt-0.5">{g.season} Wk{g.week} · combined: <span class="text-slate-400">{(g.winnerPts + g.loserPts).toFixed(2)}</span></p>
								</div>
							{/each}
						{/if}
					</div>
				</section>

			</div>
		{/if}
	{/if}
</div>
