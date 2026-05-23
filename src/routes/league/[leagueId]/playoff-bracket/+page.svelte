<script lang="ts">
	import type { PageData } from './$types';
	import {
		fetchLeague, fetchLeagueCore, fetchUsers, fetchWinnersBracket, fetchLosersBracket,
		fetchMatchups, buildRosterInfoMap, fetchDisplayNameOverrides,
	} from '$lib/sleeper';

	let { data } = $props<{ data: PageData }>();

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

	let seasons = $state<SeasonBracket[]>([]);
	let selectedIdx = $state(0);
	let loading = $state(true);
	let loadingStatus = $state('Fetching league history…');
	let error = $state('');

	function roundLabel(r: number, maxR: number, entry: any, losers: boolean): string {
		if (losers) return r === maxR ? 'Toilet Bowl' : `Round ${r}`;
		if (r === maxR) return entry.t1_from?.w != null ? 'Championship' : '3rd Place';
		if (r === maxR - 1) return 'Semifinals';
		return `Round ${r}`;
	}

	$effect(() => {
		const leagueId = data.leagueId;
		seasons = [];
		selectedIdx = 0;
		loading = true;
		loadingStatus = 'Fetching league history…';
		error = '';

		(async () => {
			try {
				const current = await fetchLeague(leagueId);
				if (data.leagueId !== leagueId) return;

				// Fetch display name overrides once using current league's membership
				const currentUsers = await fetchUsers(leagueId).catch(() => []);
				const nameOverrides = await fetchDisplayNameOverrides(currentUsers.map(u => u.user_id));

				// Skip current season if it's pre-draft/drafting (no playoff data yet)
				let curId: string | null =
					current.status === 'pre_draft' || current.status === 'drafting'
						? current.previous_league_id
						: current.league_id;

				while (curId && curId !== '0') {
					const lid = curId;

					const [{ league, rosters, users }, winnersData, losersData] = await Promise.all([
						fetchLeagueCore(lid),
						fetchWinnersBracket(lid),
						fetchLosersBracket(lid),
					]);

					if (data.leagueId !== leagueId) return;
					loadingStatus = `Loading ${league.season}…`;

					const rosterInfo = buildRosterInfoMap(rosters, users, nameOverrides);
					const playoffStart = league.settings?.playoff_week_start ?? 15;
					const playoffType = league.settings?.playoff_round_type ?? 0;
					const playoffTeams = league.settings?.playoff_teams ?? 4;
					const numRounds = Math.ceil(Math.log2(Math.max(playoffTeams, 2)));
					const weeksPerRound = playoffType === 2 ? 2 : 1;

					const playoffWeeks: number[] = [];
					for (let r = 0; r < numRounds; r++) {
						for (let w = 0; w < weeksPerRound; w++) {
							playoffWeeks.push(playoffStart + r * weeksPerRound + w);
						}
					}

					const weekDataArr = await Promise.all(
						playoffWeeks.map(w => fetchMatchups(lid, w).catch(() => []))
					);
					if (data.leagueId !== leagueId) return;

					const weekPoints = new Map<number, Map<number, number>>();
					for (let i = 0; i < playoffWeeks.length; i++) {
						const rp = new Map<number, number>();
						for (const m of weekDataArr[i] ?? []) rp.set(m.roster_id, m.points ?? 0);
						weekPoints.set(playoffWeeks[i], rp);
					}

					function getPoints(rosterId: number, round: number): number | null {
						const week = playoffStart + (round - 1);
						const pts = weekPoints.get(week)?.get(rosterId) ?? null;
						if (pts === null) return null;
						if (playoffType === 2) {
							return pts + (weekPoints.get(week + 1)?.get(rosterId) ?? 0);
						}
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
						seasons = [...seasons, { season: league.season, leagueId: lid, winnersRounds, losersRounds }];
					}

					curId = league.previous_league_id ?? null;
				}
			} catch (e: any) {
				if (data.leagueId !== leagueId) return;
				error = e.message;
			} finally {
				if (data.leagueId !== leagueId) return;
				loading = false;
			}
		})();
	});

	const season = $derived(seasons[selectedIdx]);
</script>

<div>
	<!-- Header -->
	<div class="mb-6">
		<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">Playoff Bracket</h1>
	</div>

	{#if loading && seasons.length === 0}
		<div class="space-y-3">
			{#each Array(3) as _}
				<div class="h-12 bg-navy-850 rounded-lg animate-pulse"></div>
			{/each}
			<p class="text-navy-500 text-sm">{loadingStatus}</p>
		</div>
	{:else if error && seasons.length === 0}
		<p class="text-red-400">Failed to load brackets: {error}</p>
	{:else if seasons.length === 0}
		<p class="text-navy-500">No completed playoff brackets found.</p>
	{:else}
		<!-- Season tabs -->
		<div class="flex mb-8 border-b border-navy-700 flex-wrap">
			{#each seasons as s, i}
				<button
					onclick={() => (selectedIdx = i)}
					class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
					       {selectedIdx === i ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
				>
					{s.season}
				</button>
			{/each}
			{#if loading}
				<span class="px-4 py-2.5 text-xs text-navy-500 italic self-center">{loadingStatus}</span>
			{/if}
		</div>

		{#if season}
			{#snippet bracketSection(rounds: BracketMatch[][], title: string, finalIcon: string)}
				{#if rounds.length > 0}
					<div class="mb-10">
						<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-4 flex items-center gap-2">
							<span class="text-amber-400">◆</span>{title}
						</h2>
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
											            {isChampionRound ? 'border-amber-500/40 shadow-lg shadow-amber-900/20' : 'border-navy-700'}">
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
														                ? isChampionRound ? 'bg-amber-950/60' : 'bg-navy-800'
														                : 'bg-navy-850'}">
															{#if side.avatar}
																<img src={side.avatar} alt=""
																	class="w-7 h-7 rounded-full object-cover shrink-0
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

			{@render bracketSection(season.winnersRounds, 'Championship Bracket', '🏆')}
			{@render bracketSection(season.losersRounds, 'Toilet Bowl Bracket', '🚽')}
		{/if}
	{/if}
</div>
