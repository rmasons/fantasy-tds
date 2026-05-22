<script lang="ts">
	import type { PageData } from './$types';
	import type { SleeperRoster, SleeperLeagueUser, SleeperNflState } from '$lib/types';
	import { onMount } from 'svelte';

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
		label: string; // "Championship", "3rd Place", "Semifinals", "Round N", "Toilet Bowl"
	}

	// weekly state
	let allMatchups = $state<Record<number, Matchup[]>>({});
	let selectedWeek = $state(1);
	let maxWeek = $state(1);
	let regularSeasonLength = $state(17);
	let loading = $state(true);
	let weekLoading = $state(false);
	let error = $state('');
	let season = $state('');

	// bracket state
	let view = $state<'weekly' | 'bracket'>('weekly');
	let winnersRounds = $state<BracketMatch[][]>([]);
	let losersRounds = $state<BracketMatch[][]>([]);
	let bracketLoading = $state(false);
	let bracketLoaded = $state(false);
	let playoffStart = $state(15);
	let playoffType = $state(0);

	let userMap = new Map<number, { teamName: string; ownerName: string; avatar: string | null }>();

	onMount(async () => {
		try {
			const [rostersRes, usersRes, leagueRes, nflRes] = await Promise.all([
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/rosters`),
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/users`),
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}`),
				fetch('https://api.sleeper.app/v1/state/nfl')
			]);
			const [rosters, users, league, nfl]: [SleeperRoster[], SleeperLeagueUser[], any, SleeperNflState] =
				await Promise.all([rostersRes.json(), usersRes.json(), leagueRes.json(), nflRes.json()]);

			season = league.season;
			playoffStart = league.settings?.playoff_week_start ?? 15;
			playoffType = league.settings?.playoff_round_type ?? 0;
			regularSeasonLength = playoffStart - 1;

			const rawUserMap = new Map<string, SleeperLeagueUser>(users.map((u) => [u.user_id, u]));
			for (const r of rosters) {
				const u = rawUserMap.get(r.owner_id);
				const avatarHash = u?.metadata?.avatar ?? u?.avatar;
				userMap.set(r.roster_id, {
					teamName: u?.metadata?.team_name ?? u?.display_name ?? 'Unknown',
					ownerName: u?.display_name ?? '',
					avatar: avatarHash ? `https://sleepercdn.com/avatars/thumbs/${avatarHash}` : null
				});
			}

			let week = 1;
			if (league.status === 'complete') {
				week = 18; maxWeek = 18;
			} else if (nfl.season_type === 'regular') {
				week = Math.min(nfl.display_week, regularSeasonLength);
				maxWeek = week;
			} else if (nfl.season_type === 'post') {
				week = regularSeasonLength; maxWeek = 18;
			}
			selectedWeek = week;

			await loadWeek(week);
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	});

	async function loadWeek(week: number) {
		if (allMatchups[week]) { selectedWeek = week; return; }
		weekLoading = true;
		try {
			const res = await fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/matchups/${week}`);
			const raw: { roster_id: number; matchup_id: number; points: number; starters: string[] }[] = await res.json();

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

			const [winnersRes, losersRes, ...weekRess] = await Promise.all([
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/winners_bracket`),
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/losers_bracket`),
				...playoffWeeks.map(w => fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/matchups/${w}`))
			]);

			const [winnersData, losersData, ...weekDataArr]: [any[], any[], ...any[][]] = await Promise.all([
				winnersRes.json(), losersRes.json(),
				...weekRess.map(r => r.json())
			]);

			// week -> roster_id -> points
			const weekPoints = new Map<number, Map<number, number>>();
			for (let i = 0; i < weekDataArr.length; i++) {
				const rp = new Map<number, number>();
				for (const m of weekDataArr[i] ?? []) rp.set(m.roster_id, m.points ?? 0);
				weekPoints.set(playoffWeeks[i], rp);
			}

			function getPoints(rosterId: number | null, round: number): number | null {
				if (!rosterId) return null;
				// simple: round r of winners/losers bracket corresponds to playoffStart + r - 1
				// for 2-week rounds (playoffType 2), sum two consecutive weeks
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
</script>

<div>
	<!-- Header + view toggle -->
	<div class="flex items-start justify-between mb-6 flex-wrap gap-3">
		<div>
			<h1 class="text-2xl font-bold">Matchups</h1>
			<p class="text-gray-500 text-sm">{season} Season</p>
		</div>
		<div class="flex items-center gap-2">
			<!-- View tabs -->
			<div class="flex gap-1 bg-gray-900 rounded-xl p-1">
				<button
					onclick={() => (view = 'weekly')}
					class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
					       {view === 'weekly' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}"
				>Weekly</button>
				<button
					onclick={() => loadBracket()}
					class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
					       {view === 'bracket' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}"
				>
					{bracketLoading ? 'Loading…' : 'Bracket'}
				</button>
			</div>

			<!-- Week selector (weekly view only) -->
			{#if view === 'weekly'}
				<div class="flex items-center gap-1 bg-gray-900 rounded-xl p-1">
					<button
						onclick={() => selectedWeek > 1 && loadWeek(selectedWeek - 1)}
						disabled={selectedWeek <= 1 || weekLoading}
						class="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
					>‹</button>
					<span class="px-3 py-1.5 text-sm font-medium text-white min-w-[80px] text-center">
						{selectedWeek <= regularSeasonLength ? `Week ${selectedWeek}` : `Playoffs Wk ${selectedWeek - regularSeasonLength}`}
					</span>
					<button
						onclick={() => selectedWeek < maxWeek && loadWeek(selectedWeek + 1)}
						disabled={selectedWeek >= maxWeek || weekLoading}
						class="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-white disabled:opacity-30 transition-colors"
					>›</button>
				</div>
			{/if}
		</div>
	</div>

	{#if loading}
		<div class="grid sm:grid-cols-2 gap-4">
			{#each Array(6) as _}
				<div class="h-28 bg-gray-800 rounded-xl animate-pulse"></div>
			{/each}
		</div>
	{:else if error}
		<p class="text-red-400">Failed to load matchups: {error}</p>

	<!-- ── WEEKLY VIEW ─────────────────────────────────── -->
	{:else if view === 'weekly'}
		{#if weekLoading}
			<div class="grid sm:grid-cols-2 gap-4">
				{#each Array(6) as _}
					<div class="h-28 bg-gray-800 rounded-xl animate-pulse"></div>
				{/each}
			</div>
		{:else if weekMatchups.length === 0}
			<p class="text-gray-400">No matchups found for this week.</p>
		{:else}
			<div class="grid sm:grid-cols-2 gap-4">
				{#each weekMatchups as matchup (matchup.id)}
					{@const homeWon = matchup.home.points > matchup.away.points}
					{@const awayWon = matchup.away.points > matchup.home.points}
					<div class="bg-gray-900 rounded-xl overflow-hidden border border-gray-800">
						{#each [{ team: matchup.home, won: homeWon }, { team: matchup.away, won: awayWon }] as side, i}
							<div class="flex items-center gap-3 px-4 py-3 {i === 0 ? 'border-b border-gray-800' : ''}
							            {side.won ? 'bg-gray-800/60' : ''}">
								{#if side.team.avatar}
									<img src={side.team.avatar} alt="" class="w-10 h-10 rounded-full object-cover shrink-0" />
								{:else}
									<div class="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center shrink-0">🏈</div>
								{/if}
								<div class="flex-1 min-w-0">
									<p class="font-medium text-sm truncate {side.won ? 'text-white' : 'text-gray-300'}">{side.team.teamName}</p>
									{#if side.team.ownerName && side.team.ownerName !== side.team.teamName}
										<p class="text-xs text-gray-500 truncate">{side.team.ownerName}</p>
									{/if}
								</div>
								<div class="text-right shrink-0 flex items-center gap-2">
									{#if side.won}<span class="text-green-500 text-xs font-bold">W</span>{/if}
									<span class="font-mono font-semibold text-lg {side.won ? 'text-white' : 'text-gray-400'}">
										{side.team.points.toFixed(2)}
									</span>
								</div>
							</div>
						{/each}
					</div>
				{/each}
			</div>
		{/if}

	<!-- ── BRACKET VIEW ────────────────────────────────── -->
	{:else if view === 'bracket'}
		{#if bracketLoading}
			<div class="space-y-3">
				{#each Array(4) as _}
					<div class="h-16 bg-gray-800 rounded-xl animate-pulse"></div>
				{/each}
			</div>
		{:else if winnersRounds.length === 0 && losersRounds.length === 0}
			<p class="text-gray-400">No bracket data available for this season.</p>
		{:else}
			<!-- Bracket: horizontal scroll, rounds as columns -->
			{#snippet bracketSection(rounds: BracketMatch[][], title: string, finalIcon: string)}
				{#if rounds.length > 0}
					<div class="mb-8">
						<h2 class="text-base font-semibold text-gray-300 mb-4">{title}</h2>
						<div class="overflow-x-auto pb-2">
							<div class="flex gap-4 items-start min-w-max">
								{#each rounds as roundMatches, ri}
									<div class="flex flex-col gap-3" style="min-width: 180px; max-width: 220px;">
										<!-- Round label (use first match's label) -->
										<p class="text-xs text-gray-500 uppercase tracking-wider text-center">
											{roundMatches[0]?.label ?? `Round ${ri + 1}`}
										</p>
										{#each roundMatches as match}
											{@const isLast = ri === rounds.length - 1}
											<div class="bg-gray-900 rounded-xl border {isLast ? 'border-yellow-600/40' : 'border-gray-800'} overflow-hidden">
												{#each [match.t1, match.t2] as side, si}
													{#if side.bye}
														<div class="flex items-center gap-2 px-3 py-2 {si === 0 ? 'border-b border-gray-800' : ''} text-gray-600 text-xs italic">
															BYE
														</div>
													{:else}
														<div class="flex items-center gap-2 px-3 py-2 {si === 0 ? 'border-b border-gray-800' : ''}
														            {side.won ? 'bg-gray-800/70' : ''}">
															{#if side.avatar}
																<img src={side.avatar} alt="" class="w-7 h-7 rounded-full object-cover shrink-0" />
															{:else}
																<div class="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-sm shrink-0">🏈</div>
															{/if}
															<span class="text-xs font-medium truncate flex-1 {side.won ? 'text-white' : 'text-gray-400'}">
																{side.teamName ?? '—'}
															</span>
															{#if side.won && isLast}
																<span class="text-sm shrink-0">{finalIcon}</span>
															{:else if side.won}
																<span class="text-green-500 text-xs font-bold shrink-0">W</span>
															{/if}
															{#if side.points !== null}
																<span class="font-mono text-xs {side.won ? 'text-white' : 'text-gray-500'} shrink-0">
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

			{@render bracketSection(winnersRounds, 'Championship Bracket', '🏆')}
			{@render bracketSection(losersRounds, 'Toilet Bowl Bracket', '🚽')}
		{/if}
	{/if}
</div>
