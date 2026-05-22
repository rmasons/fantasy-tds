<script lang="ts">
	import type { PageData } from './$types';
	import type { RosterInfo } from '$lib/sleeper';
	import {
		fetchLeagueCore, fetchNflState, fetchMatchups as fetchWeekMatchups,
		fetchWinnersBracket, fetchLosersBracket, buildRosterInfoMap
	} from '$lib/sleeper';

	let { data } = $props<{ data: PageData }>();

	interface MatchupTeam {
		rosterId: number;
		teamName: string;
		ownerName: string;
		avatar: string | null;
		points: number;
		starters: string[];
	}
	interface Matchup { id: number; home: MatchupTeam; away: MatchupTeam }

	interface BracketSide {
		rosterId: number | null;
		teamName: string | null;
		avatar: string | null;
		points: number | null;
		won: boolean;
		bye: boolean;
	}
	interface BracketMatch {
		round: number;
		matchId: number;
		t1: BracketSide;
		t2: BracketSide;
		label: string;
	}

	let allMatchups = $state<Record<number, Matchup[]>>({});
	let selectedWeek = $state(1);
	let maxWeek = $state(1);
	let regularSeasonLength = $state(17);
	let loading = $state(true);
	let weekLoading = $state(false);
	let error = $state('');
	let season = $state('');

	let view = $state<'weekly' | 'bracket'>('weekly');
	let winnersRounds = $state<BracketMatch[][]>([]);
	let losersRounds = $state<BracketMatch[][]>([]);
	let bracketLoading = $state(false);
	let bracketLoaded = $state(false);
	let playoffStart = $state(15);
	let playoffType = $state(0);

	let userMap = new Map<number, RosterInfo>();

	$effect(() => {
		const leagueId = data.leagueId;
		allMatchups = {};
		selectedWeek = 1;
		maxWeek = 1;
		loading = true;
		error = '';
		season = '';
		view = 'weekly';
		bracketLoaded = false;
		winnersRounds = [];
		losersRounds = [];
		userMap = new Map();

		(async () => {
			try {
				const [{ league, rosters, users }, nfl] = await Promise.all([
					fetchLeagueCore(leagueId),
					fetchNflState(),
				]);

				if (data.leagueId !== leagueId) return;

				season = league.season;
				playoffStart = league.settings?.playoff_week_start ?? 15;
				playoffType = league.settings?.playoff_round_type ?? 0;
				regularSeasonLength = playoffStart - 1;

				userMap = buildRosterInfoMap(rosters, users);

				const playoffTeams = league.settings?.playoff_teams ?? 4;
				const numRounds = Math.ceil(Math.log2(Math.max(playoffTeams, 2)));
				const weeksPerRound = playoffType === 2 ? 2 : 1;
				const lastPlayoffWeek = playoffStart + numRounds * weeksPerRound - 1;

				let week = 1;
				if (league.status === 'complete') {
					week = lastPlayoffWeek; maxWeek = lastPlayoffWeek;
				} else if (nfl.season_type === 'regular') {
					week = Math.min(nfl.display_week, regularSeasonLength);
					maxWeek = week;
				} else if (nfl.season_type === 'post') {
					week = regularSeasonLength; maxWeek = lastPlayoffWeek;
				}
				selectedWeek = week;

				await loadWeek(week);
			} catch (e: any) {
				if (data.leagueId !== leagueId) return;
				error = e.message;
			} finally {
				if (data.leagueId !== leagueId) return;
				loading = false;
			}
		})();
	});

	async function loadWeek(week: number) {
		if (allMatchups[week]) { selectedWeek = week; return; }
		weekLoading = true;
		try {
			const raw = await fetchWeekMatchups(data.leagueId, week);

			const grouped: Record<number, MatchupTeam[]> = {};
			for (const m of raw) {
				if (!grouped[m.matchup_id]) grouped[m.matchup_id] = [];
				const info = userMap.get(m.roster_id) ?? { teamName: `Team ${m.roster_id}`, ownerName: '', avatar: null };
				grouped[m.matchup_id].push({ rosterId: m.roster_id, ...info, points: m.points ?? 0, starters: m.starters ?? [] });
			}

			allMatchups = {
				...allMatchups,
				[week]: Object.values(grouped)
					.filter((pair) => pair.length === 2)
					.map((pair) => ({ id: pair[0].rosterId * 100 + pair[1].rosterId, home: pair[0], away: pair[1] }))
			};
			selectedWeek = week;
		} finally {
			weekLoading = false;
		}
	}

	async function loadBracket() {
		if (bracketLoaded) { view = 'bracket'; return; }
		bracketLoading = true;
		try {
			const playoffWeeks = Array.from({ length: 18 - playoffStart + 1 }, (_, i) => playoffStart + i);

			const [winnersData, losersData, ...weekDataArr]: [any[], any[], ...any[][]] = await Promise.all([
				fetchWinnersBracket(data.leagueId),
				fetchLosersBracket(data.leagueId),
				...playoffWeeks.map(w => fetchWeekMatchups(data.leagueId, w))
			]);

			const weekPoints = new Map<number, Map<number, number>>();
			for (let i = 0; i < weekDataArr.length; i++) {
				const rp = new Map<number, number>();
				for (const m of weekDataArr[i] ?? []) rp.set(m.roster_id, m.points ?? 0);
				weekPoints.set(playoffWeeks[i], rp);
			}

			function getPoints(rosterId: number | null, round: number): number | null {
				if (!rosterId) return null;
				const week = playoffStart + round - 1;
				const pts = weekPoints.get(week)?.get(rosterId) ?? null;
				if (pts === null) return null;
				if (playoffType === 2) {
					const wk2 = weekPoints.get(week + 1)?.get(rosterId) ?? 0;
					return pts + wk2;
				}
				return pts;
			}

			function teamSide(rosterId: number | null, winnerId: number | null, round: number): BracketSide {
				const info = rosterId ? (userMap.get(rosterId) ?? { teamName: `Team ${rosterId}`, ownerName: '', avatar: null }) : null;
				return {
					rosterId,
					teamName: info?.teamName ?? null,
					avatar: info?.avatar ?? null,
					points: rosterId ? getPoints(rosterId, round) : null,
					won: !!rosterId && rosterId === winnerId,
					bye: !rosterId,
				};
			}

			function roundLabel(r: number, maxR: number, entry: any, losers: boolean): string {
				if (losers) return r === maxR ? 'Toilet Bowl' : `Round ${r}`;
				if (r === maxR) return (entry.t1_from?.w != null) ? 'Championship' : '3rd Place';
				if (r === maxR - 1) return 'Semifinals';
				return `Round ${r}`;
			}

			function processBracket(raw: any[], losers: boolean): BracketMatch[][] {
				if (!raw?.length) return [];
				const maxR = raw[raw.length - 1].r;
				const byRound: BracketMatch[][] = [];
				for (let r = 1; r <= maxR; r++) {
					byRound.push(
						raw.filter(e => e.r === r).map(e => ({
							round: r,
							matchId: e.m,
							t1: teamSide(e.t1 ?? null, e.w ?? null, r),
							t2: teamSide(e.t2 ?? null, e.w ?? null, r),
							label: roundLabel(r, maxR, e, losers),
						}))
					);
				}
				return byRound;
			}

			winnersRounds = processBracket(winnersData, false);
			losersRounds = processBracket(losersData, true);
			bracketLoaded = true;
		} catch (e: any) {
			error = e.message;
		} finally {
			bracketLoading = false;
		}
		view = 'bracket';
	}

	const weekMatchups = $derived(allMatchups[selectedWeek] ?? []);

	function weekLabel(week: number): string {
		return week <= regularSeasonLength
			? `Week ${week}`
			: `Playoffs · Wk ${week - regularSeasonLength}`;
	}
</script>

<div>
	<!-- Header -->
	<div class="flex items-start justify-between mb-6 flex-wrap gap-3">
		<div>
			<h1 class="text-2xl font-extrabold text-white">Matchups</h1>
			<p class="text-slate-500 text-sm mt-0.5">{season} Season</p>
		</div>
		<div class="flex items-center gap-2">
			<!-- View tabs -->
			<div class="flex gap-1 bg-slate-900 rounded-xl p-1">
				<button
					onclick={() => (view = 'weekly')}
					class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
					       {view === 'weekly' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}"
				>Weekly</button>
				<button
					onclick={() => loadBracket()}
					class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
					       {view === 'bracket' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white'}"
				>
					{bracketLoading ? 'Loading…' : 'Bracket'}
				</button>
			</div>

			<!-- Week navigator -->
			{#if view === 'weekly'}
				<div class="flex items-center gap-0.5 bg-slate-900 rounded-xl p-1">
					<button
						onclick={() => selectedWeek > 1 && loadWeek(selectedWeek - 1)}
						disabled={selectedWeek <= 1 || weekLoading}
						class="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
					>‹</button>
					<select
						value={selectedWeek}
						onchange={(e) => loadWeek(parseInt((e.target as HTMLSelectElement).value))}
						disabled={weekLoading}
						class="bg-transparent text-sm font-semibold text-white px-2 py-1.5 focus:outline-none cursor-pointer disabled:opacity-50"
					>
						{#each Array.from({ length: maxWeek }, (_, i) => i + 1) as w}
							<option value={w} class="bg-slate-900">{weekLabel(w)}</option>
						{/each}
					</select>
					<button
						onclick={() => selectedWeek < maxWeek && loadWeek(selectedWeek + 1)}
						disabled={selectedWeek >= maxWeek || weekLoading}
						class="px-3 py-1.5 rounded-lg text-sm text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
					>›</button>
				</div>
			{/if}
		</div>
	</div>

	{#if loading}
		<div class="grid sm:grid-cols-2 gap-3">
			{#each Array(6) as _}
				<div class="h-16 bg-slate-800 rounded-xl animate-pulse"></div>
			{/each}
		</div>

	{:else if error}
		<p class="text-red-400">Failed to load matchups: {error}</p>

	<!-- ── WEEKLY VIEW ─────────────────────────────────── -->
	{:else if view === 'weekly'}
		{#if weekLoading}
			<div class="grid sm:grid-cols-2 gap-3">
				{#each Array(6) as _}
					<div class="h-16 bg-slate-800 rounded-xl animate-pulse"></div>
				{/each}
			</div>
		{:else if weekMatchups.length === 0}
			<p class="text-slate-400">No matchups found for this week.</p>
		{:else}
			<!-- Pill-style matchup cards -->
			<div class="grid sm:grid-cols-2 gap-3">
				{#each weekMatchups as matchup (matchup.id)}
					{@const homeWon = matchup.home.points > matchup.away.points}
					{@const awayWon = matchup.away.points > matchup.home.points}

					<div class="flex rounded-xl overflow-hidden border border-slate-700/30 shadow-lg">
						<!-- Home team (left half) -->
						<div class="flex-1 flex items-center gap-2 px-3 py-3 min-w-0
						            {homeWon ? 'bg-red-900/80' : 'bg-slate-800/90'}">
							{#if matchup.home.avatar}
								<img src={matchup.home.avatar} alt="" class="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
							{:else}
								<div class="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center shrink-0 text-sm">🏈</div>
							{/if}
							<p class="flex-1 min-w-0 text-sm italic font-semibold truncate leading-tight
							          {homeWon ? 'text-white' : 'text-slate-400'}">
								{matchup.home.teamName}
							</p>
							<div class="shrink-0 pl-1 text-right">
								<p class="font-mono font-bold text-sm leading-none
								          {homeWon ? 'text-white' : 'text-slate-400'}">
									{matchup.home.points.toFixed(2)}
								</p>
							</div>
						</div>

						<!-- Divider -->
						<div class="w-px shrink-0 bg-slate-600/40"></div>

						<!-- Away team (right half, mirrored) -->
						<div class="flex-1 flex items-center gap-2 px-3 py-3 min-w-0
						            {awayWon ? 'bg-red-900/80' : 'bg-slate-800/90'}">
							<div class="shrink-0 pr-1 text-left">
								<p class="font-mono font-bold text-sm leading-none
								          {awayWon ? 'text-white' : 'text-slate-400'}">
									{matchup.away.points.toFixed(2)}
								</p>
							</div>
							<p class="flex-1 min-w-0 text-sm italic font-semibold text-right truncate leading-tight
							          {awayWon ? 'text-white' : 'text-slate-400'}">
								{matchup.away.teamName}
							</p>
							{#if matchup.away.avatar}
								<img src={matchup.away.avatar} alt="" class="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
							{:else}
								<div class="w-9 h-9 rounded-full bg-slate-700 flex items-center justify-center shrink-0 text-sm">🏈</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}

	<!-- ── BRACKET VIEW ────────────────────────────────── -->
	{:else if view === 'bracket'}
		{#if bracketLoading}
			<div class="space-y-3">
				{#each Array(4) as _}
					<div class="h-16 bg-slate-800 rounded-xl animate-pulse"></div>
				{/each}
			</div>
		{:else if winnersRounds.length === 0 && losersRounds.length === 0}
			<p class="text-slate-400">No bracket data available for this season.</p>
		{:else}
			{#snippet bracketSection(rounds: BracketMatch[][], title: string, finalIcon: string, accent: string)}
				{#if rounds.length > 0}
					<div class="mb-10">
						<h2 class="text-sm font-bold text-slate-400 uppercase tracking-widest mb-4">{title}</h2>
						<div class="overflow-x-auto pb-3">
							<div class="flex gap-4 items-start min-w-max">
								{#each rounds as roundMatches, ri}
									{@const isChampionRound = ri === rounds.length - 1}
									<div class="flex flex-col gap-3" style="min-width: 190px; max-width: 230px;">
										<p class="text-xs text-slate-500 uppercase tracking-wider text-center font-medium">
											{roundMatches[0]?.label ?? `Round ${ri + 1}`}
										</p>
										{#each roundMatches as match}
											<div class="rounded-xl overflow-hidden border
											            {isChampionRound
											                ? 'border-amber-500/40 shadow-lg shadow-amber-900/20'
											                : 'border-slate-700/60'}">
												{#each [match.t1, match.t2] as side, si}
													{#if side.bye}
														<div class="flex items-center gap-2 px-3 py-2.5
														            {si === 0 ? 'border-b border-slate-800' : ''}
														            bg-slate-900 text-slate-600 text-xs italic">
															BYE
														</div>
													{:else}
														<div class="flex items-center gap-2 px-3 py-2.5
														            {si === 0 ? 'border-b border-slate-800/80' : ''}
														            {side.won
														                ? isChampionRound
														                    ? 'bg-amber-950/60'
														                    : 'bg-slate-800'
														                : 'bg-slate-900/80'}">
															{#if side.avatar}
																<img src={side.avatar} alt="" class="w-7 h-7 rounded-full object-cover shrink-0
																            {side.won ? 'ring-2 ring-white/30' : 'opacity-60'}" />
															{:else}
																<div class="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-sm shrink-0
																            {side.won ? '' : 'opacity-50'}">🏈</div>
															{/if}
															<span class="text-xs font-semibold truncate flex-1 leading-tight
															             {side.won
															                 ? isChampionRound ? 'text-amber-200' : 'text-white'
															                 : 'text-slate-500'}">
																{side.teamName ?? '—'}
															</span>
															{#if side.won && isChampionRound}
																<span class="text-sm shrink-0">{finalIcon}</span>
															{/if}
															{#if side.points !== null}
																<span class="font-mono text-xs shrink-0
																             {side.won ? 'text-white' : 'text-slate-600'}">
																	{side.points.toFixed(1)}
																</span>
															{/if}
														</div>
													{/if}
												{/each}
											</div>
										{/each}
									</div>
								{/each}
							</div>
						</div>
					</div>
				{/if}
			{/snippet}

			{@render bracketSection(winnersRounds, 'Championship Bracket', '🏆', 'amber')}
			{@render bracketSection(losersRounds, 'Toilet Bowl Bracket', '🚽', 'slate')}
		{/if}
	{/if}
</div>
