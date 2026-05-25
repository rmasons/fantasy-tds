<script lang="ts">
	import type { PageData } from './$types';
	import type { RosterInfo } from '$lib/sleeper';
	import FaabEasterEgg from '$lib/components/FaabEasterEgg.svelte';
	import {
		fetchLeagueCore, fetchNflState, fetchMatchups as fetchWeekMatchups,
		fetchWinnersBracket, fetchLosersBracket, buildRosterInfoMap, fetchDisplayNameOverrides
	} from '$lib/sleeper';

	let { data } = $props<{ data: PageData }>();

	interface MatchupTeam {
		rosterId: number;
		teamName: string;
		ownerName: string | null;
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
	interface SeasonBracket {
		season: string;
		leagueId: string;
		winnersRounds: BracketMatch[][];
		losersRounds: BracketMatch[][];
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
	let bracketSeasons = $state<SeasonBracket[]>([]);
	let bracketSelectedIdx = $state(0);
	let bracketLoading = $state(false);
	let bracketLoaded = $state(false);
	let bracketLoadingStatus = $state('');
	let playoffStart = $state(15);

	let userMap = new Map<number, RosterInfo>();
	let savedOverrides: Record<string, string> = {};
	let bracketStartLeagueId = '';

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
		bracketSeasons = [];
		bracketSelectedIdx = 0;
		bracketLoadingStatus = '';
		userMap = new Map();
		savedOverrides = {};
		bracketStartLeagueId = '';

		(async () => {
			try {
				const [{ league, rosters, users }, nfl] = await Promise.all([
					fetchLeagueCore(leagueId),
					fetchNflState(),
				]);

				if (data.leagueId !== leagueId) return;

				season = league.season;
				playoffStart = league.settings?.playoff_week_start ?? 15;
				const pType = league.settings?.playoff_round_type ?? 0;
				regularSeasonLength = playoffStart - 1;

				const prevId = league.previous_league_id ?? '';
				if (league.status === 'pre_draft' || league.status === 'drafting') {
					bracketStartLeagueId = (prevId && prevId !== '0') ? prevId : '';
				} else {
					bracketStartLeagueId = leagueId;
				}

				const overrides = await fetchDisplayNameOverrides(users.map(u => u.user_id));
				if (data.leagueId !== leagueId) return;
				savedOverrides = overrides;
				userMap = buildRosterInfoMap(rosters, users, overrides);

				const playoffTeams = league.settings?.playoff_teams ?? 4;
				const numRounds = Math.ceil(Math.log2(Math.max(playoffTeams, 2)));
				const weeksPerRound = pType === 2 ? 2 : 1;
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
				const info = userMap.get(m.roster_id) ?? { teamName: `Team ${m.roster_id}`, ownerName: null, avatar: null };
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

	function roundLabel(r: number, maxR: number, entry: any, losers: boolean): string {
		if (losers) return r === maxR ? 'Toilet Bowl' : `Round ${r}`;
		if (r === maxR) return (entry.t1_from?.w != null) ? 'Championship' : '3rd Place';
		if (r === maxR - 1) return 'Semifinals';
		return `Round ${r}`;
	}

	async function loadBracket() {
		if (bracketLoaded) { view = 'bracket'; return; }
		if (!bracketStartLeagueId) { view = 'bracket'; return; }

		bracketLoading = true;
		bracketLoadingStatus = 'Fetching league history…';
		const leagueId = data.leagueId;

		try {
			let curId: string | null = bracketStartLeagueId;

			while (curId && curId !== '0') {
				const lid = curId;
				if (data.leagueId !== leagueId) return;

				const [{ league, rosters, users }, winnersData, losersData] = await Promise.all([
					fetchLeagueCore(lid),
					fetchWinnersBracket(lid),
					fetchLosersBracket(lid),
				]);

				if (data.leagueId !== leagueId) return;
				bracketLoadingStatus = `Loading ${league.season}…`;

				const rosterInfo = buildRosterInfoMap(rosters, users, savedOverrides);
				const pStart = league.settings?.playoff_week_start ?? 15;
				const pType = league.settings?.playoff_round_type ?? 0;
				const pTeams = league.settings?.playoff_teams ?? 4;
				const nRounds = Math.ceil(Math.log2(Math.max(pTeams, 2)));
				const wpr = pType === 2 ? 2 : 1;

				const playoffWeeks: number[] = [];
				for (let r = 0; r < nRounds; r++) {
					for (let w = 0; w < wpr; w++) {
						playoffWeeks.push(pStart + r * wpr + w);
					}
				}

				const weekDataArr = await Promise.all(
					playoffWeeks.map(w => fetchWeekMatchups(lid, w).catch(() => []))
				);
				if (data.leagueId !== leagueId) return;

				const weekPoints = new Map<number, Map<number, number>>();
				for (let i = 0; i < playoffWeeks.length; i++) {
					const rp = new Map<number, number>();
					for (const m of weekDataArr[i] ?? []) rp.set(m.roster_id, m.points ?? 0);
					weekPoints.set(playoffWeeks[i], rp);
				}

				function getPoints(rosterId: number, round: number): number | null {
					const week = pStart + (round - 1);
					const pts = weekPoints.get(week)?.get(rosterId) ?? null;
					if (pts === null) return null;
					if (pType === 2) return pts + (weekPoints.get(week + 1)?.get(rosterId) ?? 0);
					return pts;
				}

				function teamSide(rosterId: number | null, winnerId: number | null, round: number): BracketSide {
					const info = rosterId ? rosterInfo.get(rosterId) : null;
					return {
						rosterId,
						teamName: info?.teamName ?? (rosterId ? `Team ${rosterId}` : null),
						avatar: info?.avatar ?? null,
						points: rosterId ? getPoints(rosterId, round) : null,
						won: !!rosterId && rosterId === winnerId,
						bye: !rosterId,
					};
				}

				function processBracket(raw: any[], losers: boolean): BracketMatch[][] {
					if (!raw?.length) return [];
					const maxR = Math.max(...raw.map((m: any) => m.r));
					const byRound: BracketMatch[][] = [];
					for (let r = 1; r <= maxR; r++) {
						byRound.push(
							raw.filter((e: any) => e.r === r).map((e: any) => ({
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

				const winnersRounds = processBracket(winnersData, false);
				const losersRounds = processBracket(losersData, true);

				if (winnersRounds.length > 0) {
					bracketSeasons = [...bracketSeasons, { season: league.season, leagueId: lid, winnersRounds, losersRounds }];
				}

				curId = league.previous_league_id ?? null;
			}

			bracketLoaded = true;
		} catch (e: any) {
			if (data.leagueId !== leagueId) return;
			error = e.message;
		} finally {
			if (data.leagueId !== leagueId) return;
			bracketLoading = false;
		}
		view = 'bracket';
	}

	const weekMatchups = $derived(allMatchups[selectedWeek] ?? []);
	const bracketSeason = $derived(bracketSeasons[bracketSelectedIdx]);

	function weekLabel(week: number): string {
		return week <= regularSeasonLength
			? `Week ${week}`
			: `Playoffs · Wk ${week - regularSeasonLength}`;
	}
</script>

<div>
	<!-- Header -->
	<div class="mb-6">
		<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">Matchups</h1>
		<p class="text-navy-500 text-[10px] uppercase tracking-[0.2em] font-semibold mt-1">{season} Season<FaabEasterEgg eggId="4" leagueId={data.leagueId} loggedIn={!!data.user} /></p>
	</div>

	<!-- View tabs + week navigator -->
	<div class="flex items-center justify-between mb-6 flex-wrap gap-3">
		<div class="flex border-b border-navy-700">
			<button
				onclick={() => (view = 'weekly')}
				class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
				       {view === 'weekly' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
			>Weekly</button>
			<button
				onclick={() => loadBracket()}
				class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
				       {view === 'bracket' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
			>
				{bracketLoading ? 'Loading…' : 'Bracket'}
			</button>
		</div>

		<!-- Week navigator -->
		{#if view === 'weekly'}
			<div class="flex items-center gap-0.5 bg-navy-850 rounded-lg p-1 border border-navy-700">
				<button
					onclick={() => selectedWeek > 1 && loadWeek(selectedWeek - 1)}
					disabled={selectedWeek <= 1 || weekLoading}
					class="px-3 py-1.5 rounded text-sm text-navy-500 hover:text-white disabled:opacity-30 transition-colors"
				>‹</button>
				<select
					value={selectedWeek}
					onchange={(e) => loadWeek(parseInt((e.target as HTMLSelectElement).value))}
					disabled={weekLoading}
					class="bg-transparent text-sm font-semibold text-white px-2 py-1.5 focus:outline-none cursor-pointer disabled:opacity-50"
				>
					{#each Array.from({ length: maxWeek }, (_, i) => i + 1) as w}
						<option value={w}>{weekLabel(w)}</option>
					{/each}
				</select>
				<button
					onclick={() => selectedWeek < maxWeek && loadWeek(selectedWeek + 1)}
					disabled={selectedWeek >= maxWeek || weekLoading}
					class="px-3 py-1.5 rounded text-sm text-navy-500 hover:text-white disabled:opacity-30 transition-colors"
				>›</button>
			</div>
		{/if}
	</div>

	{#if loading}
		<div class="grid sm:grid-cols-2 gap-3">
			{#each Array(6) as _}
				<div class="h-16 bg-navy-850 rounded-lg animate-pulse"></div>
			{/each}
		</div>

	{:else if error}
		<p class="text-red-400">Failed to load matchups: {error}</p>

	<!-- ── WEEKLY VIEW ─────────────────────────────────── -->
	{:else if view === 'weekly'}
		{#if weekLoading}
			<div class="grid sm:grid-cols-2 gap-3">
				{#each Array(6) as _}
					<div class="h-16 bg-navy-850 rounded-lg animate-pulse"></div>
				{/each}
			</div>
		{:else if weekMatchups.length === 0}
			<p class="text-navy-500">No matchups found for this week.</p>
		{:else}
			<!-- Scoreboard matchup cards -->
			<div class="grid sm:grid-cols-2 gap-3">
				{#each weekMatchups as matchup (matchup.id)}
					{@const homeWon = matchup.home.points > matchup.away.points}
					{@const awayWon = matchup.away.points > matchup.home.points}

					<div class="flex rounded-lg overflow-hidden border border-navy-700">
						<!-- Home team (left half) -->
						<div class="flex-1 flex items-center gap-2 px-3 py-3 min-w-0
						            {homeWon ? 'bg-red-900/80' : 'bg-navy-850'}">
							{#if matchup.home.avatar}
								<img src={matchup.home.avatar} alt="" class="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
							{:else}
								<div class="w-9 h-9 rounded-full bg-navy-800 flex items-center justify-center shrink-0 text-sm">🏈</div>
							{/if}
							<p class="flex-1 min-w-0 text-sm font-semibold truncate leading-tight
							          {homeWon ? 'text-white' : 'text-navy-500'}">
								{matchup.home.teamName}
							</p>
							<div class="shrink-0 pl-1 text-right">
								<p class="font-mono font-bold text-sm leading-none tabular-nums
								          {homeWon ? 'text-white' : 'text-navy-500'}">
									{matchup.home.points.toFixed(2)}
								</p>
							</div>
						</div>

						<!-- Divider -->
						<div class="w-px shrink-0 bg-navy-700"></div>

						<!-- Away team (right half, mirrored) -->
						<div class="flex-1 flex items-center gap-2 px-3 py-3 min-w-0
						            {awayWon ? 'bg-red-900/80' : 'bg-navy-850'}">
							<div class="shrink-0 pr-1 text-left">
								<p class="font-mono font-bold text-sm leading-none tabular-nums
								          {awayWon ? 'text-white' : 'text-navy-500'}">
									{matchup.away.points.toFixed(2)}
								</p>
							</div>
							<p class="flex-1 min-w-0 text-sm font-semibold text-right truncate leading-tight
							          {awayWon ? 'text-white' : 'text-navy-500'}">
								{matchup.away.teamName}
							</p>
							{#if matchup.away.avatar}
								<img src={matchup.away.avatar} alt="" class="w-9 h-9 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
							{:else}
								<div class="w-9 h-9 rounded-full bg-navy-800 flex items-center justify-center shrink-0 text-sm">🏈</div>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}

	<!-- ── BRACKET VIEW ────────────────────────────────── -->
	{:else if view === 'bracket'}
		{#if bracketLoading && bracketSeasons.length === 0}
			<div class="space-y-3">
				{#each Array(3) as _}
					<div class="h-12 bg-navy-850 rounded-lg animate-pulse"></div>
				{/each}
				<p class="text-navy-500 text-sm">{bracketLoadingStatus}</p>
			</div>
		{:else if bracketSeasons.length === 0}
			<p class="text-navy-500">No bracket data available for this season.</p>
		{:else}
			<!-- Season tabs -->
			<div class="flex mb-6 border-b border-navy-700 flex-wrap">
				{#each bracketSeasons as s, i}
					<button
						onclick={() => (bracketSelectedIdx = i)}
						class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
						       {bracketSelectedIdx === i ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
					>
						{s.season}
					</button>
				{/each}
				{#if bracketLoading}
					<span class="px-4 py-2.5 text-xs text-navy-500 italic self-center">{bracketLoadingStatus}</span>
				{/if}
			</div>

			{#if bracketSeason}
				{#snippet bracketSection(rounds: BracketMatch[][], title: string, finalIcon: string)}
					{#if rounds.length > 0}
						<div class="mb-10">
							<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-4 flex items-center gap-2"><span class="text-amber-400">◆</span>{title}</h2>
							<div class="overflow-x-auto pb-3">
								<div class="flex gap-4 items-start min-w-max">
									{#each rounds as roundMatches, ri}
										{@const isChampionRound = ri === rounds.length - 1}
										<div class="flex flex-col gap-3" style="min-width: 190px; max-width: 230px;">
											<p class="text-[10px] text-navy-500 uppercase tracking-wider text-center font-semibold">
												{roundMatches[0]?.label ?? `Round ${ri + 1}`}
											</p>
											{#each roundMatches as match}
												<div class="rounded-lg overflow-hidden border
												            {isChampionRound
												                ? 'border-amber-500/40'
												                : 'border-navy-700'}">
													{#each [match.t1, match.t2] as side, si}
														{#if side.bye}
															<div class="flex items-center gap-2 px-3 py-2.5
															            {si === 0 ? 'border-b border-navy-700' : ''}
															            bg-navy-850 text-navy-500 text-xs italic">
																BYE
															</div>
														{:else}
															<div class="flex items-center gap-2 px-3 py-2.5
															            {si === 0 ? 'border-b border-navy-700' : ''}
															            {side.won
															                ? isChampionRound
															                    ? 'bg-amber-950/60'
															                    : 'bg-navy-800'
															                : 'bg-navy-850'}">
																{#if side.avatar}
																	<img src={side.avatar} alt="" class="w-7 h-7 rounded-full object-cover shrink-0
																	            {side.won ? 'ring-2 ring-white/30' : 'opacity-60'}" />
																{:else}
																	<div class="w-7 h-7 rounded-full bg-navy-800 flex items-center justify-center text-sm shrink-0
																	            {side.won ? '' : 'opacity-50'}">🏈</div>
																{/if}
																<span class="text-xs font-semibold truncate flex-1 leading-tight
																             {side.won
																                 ? isChampionRound ? 'text-amber-200' : 'text-white'
																                 : 'text-navy-500'}">
																	{side.teamName ?? '—'}
																</span>
																{#if side.won && isChampionRound}
																	<span class="text-sm shrink-0">{finalIcon}</span>
																{/if}
																{#if side.points !== null}
																	<span class="font-mono text-xs shrink-0 tabular-nums
																	             {side.won ? 'text-white' : 'text-navy-500'}">
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

				{@render bracketSection(bracketSeason.winnersRounds, 'Championship Bracket', '🏆')}
				{@render bracketSection(bracketSeason.losersRounds, 'Toilet Bowl Bracket', '🚽')}
			{/if}
		{/if}
	{/if}
</div>
