<script lang="ts">
	import type { LayoutData } from '../$types';
	import type { SleeperRoster, SleeperLeagueUser } from '$lib/types';
	import { onMount } from 'svelte';

	let { data } = $props<{ data: LayoutData }>();

	interface GameResult {
		season: string;
		week: number;
		winner: string;
		loser: string;
		winnerPts: number;
		loserPts: number;
		diff: number;
	}

	interface WeekHigh {
		season: string;
		week: number;
		team: string;
		pts: number;
	}

	// ─── Season tab state ────────────────────────────────────────────────────────
	let blowouts = $state<GameResult[]>([]);
	let closest = $state<GameResult[]>([]);
	let weekHighs = $state<WeekHigh[]>([]);
	let weekLows = $state<WeekHigh[]>([]);
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
	let atBlowouts = $state<GameResult[]>([]);
	let atClosest = $state<GameResult[]>([]);
	let atHighs = $state<WeekHigh[]>([]);

	let teamName = (id: number, m: Map<number, string>) => m.get(id) ?? `Roster ${id}`;

	onMount(async () => {
		try {
			const [rostersRes, usersRes, leagueRes, nflRes] = await Promise.all([
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/rosters`),
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/users`),
				fetch(`https://api.sleeper.app/v1/league/${data.leagueId}`),
				fetch('https://api.sleeper.app/v1/state/nfl')
			]);
			const [rosters, users, league, nfl]: [SleeperRoster[], SleeperLeagueUser[], any, any] =
				await Promise.all([rostersRes.json(), usersRes.json(), leagueRes.json(), nflRes.json()]);

			season = league.season;
			const playoffStart: number = league.settings.playoff_week_start ?? 15;

			const userMap = new Map<string, SleeperLeagueUser>(users.map((u) => [u.user_id, u]));
			const rosterMap = new Map<number, string>();
			const rosterAvatarMap = new Map<number, string | null>();
			for (const r of rosters) {
				const u = userMap.get(r.owner_id);
				const name = u?.metadata?.team_name ?? u?.display_name ?? `Roster ${r.roster_id}`;
				const avatarHash = u?.metadata?.avatar ?? u?.avatar;
				rosterMap.set(r.roster_id, name);
				rosterAvatarMap.set(r.roster_id, avatarHash ? `https://sleepercdn.com/avatars/thumbs/${avatarHash}` : null);
			}

			seasonLeaders = rosters
				.map((r) => ({
					team: rosterMap.get(r.roster_id)!,
					avatar: rosterAvatarMap.get(r.roster_id) ?? null,
					fpts: (r.settings.fpts ?? 0) + (r.settings.fpts_decimal ?? 0) / 100
				}))
				.sort((a, b) => b.fpts - a.fpts);

			let completedWeeks = 0;
			if (nfl.season_type === 'regular') completedWeeks = Math.max(0, nfl.display_week - 1);
			else if (nfl.season_type === 'post') completedWeeks = playoffStart - 1;

			if (completedWeeks === 0) { loading = false; return; }

			const weekNums = Array.from({ length: completedWeeks }, (_, i) => i + 1);
			const responses = await Promise.all(
				weekNums.map((w) => fetch(`https://api.sleeper.app/v1/league/${data.leagueId}/matchups/${w}`))
			);
			const weekData: any[][] = await Promise.all(responses.map((r) => r.json()));

			const allBlowouts: GameResult[] = [];
			const allClosest: GameResult[] = [];
			const allHighs: WeekHigh[] = [];
			const allLows: WeekHigh[] = [];

			for (let wi = 0; wi < weekData.length; wi++) {
				const week = wi + 1;
				const matchups: Record<number, any[]> = {};

				for (const m of weekData[wi]) {
					if (!matchups[m.matchup_id]) matchups[m.matchup_id] = [];
					matchups[m.matchup_id].push(m);
				}

				for (const pair of Object.values(matchups)) {
					if (pair.length !== 2) continue;
					const [a, b] = pair;
					const aPts = a.points ?? 0;
					const bPts = b.points ?? 0;
					if (aPts === 0 && bPts === 0) continue;

					const [winner, loser, winPts, losPts] =
						aPts >= bPts
							? [a.roster_id, b.roster_id, aPts, bPts]
							: [b.roster_id, a.roster_id, bPts, aPts];

					const result: GameResult = {
						season,
						week,
						winner: teamName(winner, rosterMap),
						loser: teamName(loser, rosterMap),
						winnerPts: winPts,
						loserPts: losPts,
						diff: +(winPts - losPts).toFixed(2)
					};
					allBlowouts.push(result);
					allClosest.push(result);
				}

				const weekScores = weekData[wi]
					.filter((m: any) => (m.points ?? 0) > 0)
					.map((m: any) => ({ team: teamName(m.roster_id, rosterMap), pts: m.points ?? 0 }));
				if (weekScores.length) {
					weekScores.sort((a: any, b: any) => b.pts - a.pts);
					allHighs.push({ season, week, team: weekScores[0].team, pts: weekScores[0].pts });
					allLows.push({ season, week, team: weekScores[weekScores.length - 1].team, pts: weekScores[weekScores.length - 1].pts });
				}
			}

			blowouts = allBlowouts.sort((a, b) => b.diff - a.diff).slice(0, 5);
			closest = allClosest.sort((a, b) => a.diff - b.diff).slice(0, 5);
			weekHighs = allHighs.sort((a, b) => b.pts - a.pts).slice(0, 5);
			weekLows = allLows.sort((a, b) => a.pts - b.pts).slice(0, 5);
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	});

	async function loadAllTime() {
		if (atLoaded || atLoading) return;
		atLoading = true;
		atError = '';

		try {
			const firstLeagueRes = await fetch(`https://api.sleeper.app/v1/league/${data.leagueId}`);
			const firstLeague = await firstLeagueRes.json();

			const managerMap = new Map<string, AllTimeStat>();
			const allGameResults: GameResult[] = [];
			const allWeekHighs: WeekHigh[] = [];

			let curId: string = data.leagueId;

			while (curId && curId !== '0') {
				const [leagueData, users, rosters]: [any, any[], any[]] = await Promise.all([
					curId === data.leagueId
						? Promise.resolve(firstLeague)
						: fetch(`https://api.sleeper.app/v1/league/${curId}`).then(r => r.json()),
					fetch(`https://api.sleeper.app/v1/league/${curId}/users`).then(r => r.json()),
					fetch(`https://api.sleeper.app/v1/league/${curId}/rosters`).then(r => r.json()),
				]);

				const yr: string = leagueData.season;
				atStatus = `Loading ${yr}…`;
				const playoffStart: number = leagueData.settings?.playoff_week_start ?? 15;

				const userMap = new Map<string, any>(users.map((u: any) => [u.user_id, u]));
				const rosterOwnerMap = new Map<number, string>();
				const rosterNameMap = new Map<number, string>();

				for (const r of rosters) {
					const u = userMap.get(r.owner_id);
					const name = u?.metadata?.team_name ?? u?.display_name ?? `Roster ${r.roster_id}`;
					rosterOwnerMap.set(r.roster_id, r.owner_id);
					rosterNameMap.set(r.roster_id, name);

					const f = (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100;
					const fa = (r.settings?.fpts_against ?? 0) + (r.settings?.fpts_against_decimal ?? 0) / 100;
					const existing = managerMap.get(r.owner_id);

					if (existing) {
						existing.wins += r.settings?.wins ?? 0;
						existing.losses += r.settings?.losses ?? 0;
						existing.ties += r.settings?.ties ?? 0;
						existing.fpts += f;
						existing.fptsAgainst += fa;
						existing.seasons += 1;
					} else {
						const avatarHash = u?.metadata?.avatar ?? u?.avatar;
						managerMap.set(r.owner_id, {
							userId: r.owner_id,
							displayName: u?.metadata?.team_name ?? u?.display_name ?? `Roster ${r.roster_id}`,
							avatar: avatarHash ? `https://sleepercdn.com/avatars/thumbs/${avatarHash}` : null,
							wins: r.settings?.wins ?? 0,
							losses: r.settings?.losses ?? 0,
							ties: r.settings?.ties ?? 0,
							fpts: f,
							fptsAgainst: fa,
							seasons: 1,
						});
					}
				}

				// Fetch all regular-season weeks for this season
				const numWeeks = playoffStart - 1;
				if (numWeeks > 0) {
					const weekNums = Array.from({ length: numWeeks }, (_, i) => i + 1);
					const weekResponses = await Promise.all(
						weekNums.map(w => fetch(`https://api.sleeper.app/v1/league/${curId}/matchups/${w}`))
					);
					const weekData: any[][] = await Promise.all(weekResponses.map(r => r.json()));

					for (let wi = 0; wi < weekData.length; wi++) {
						const week = wi + 1;
						const matchupsThisWeek: Record<number, any[]> = {};

						for (const m of weekData[wi]) {
							if (!matchupsThisWeek[m.matchup_id]) matchupsThisWeek[m.matchup_id] = [];
							matchupsThisWeek[m.matchup_id].push(m);
						}

						for (const pair of Object.values(matchupsThisWeek)) {
							if (pair.length !== 2) continue;
							const [a, b] = pair;
							const aPts = a.points ?? 0;
							const bPts = b.points ?? 0;
							if (aPts === 0 && bPts === 0) continue;

							const [winRoster, losRoster, winPts, losPts] =
								aPts >= bPts
									? [a.roster_id, b.roster_id, aPts, bPts]
									: [b.roster_id, a.roster_id, bPts, aPts];

							allGameResults.push({
								season: yr,
								week,
								winner: rosterNameMap.get(winRoster) ?? `Roster ${winRoster}`,
								loser: rosterNameMap.get(losRoster) ?? `Roster ${losRoster}`,
								winnerPts: winPts,
								loserPts: losPts,
								diff: +(winPts - losPts).toFixed(2),
							});
						}

						const weekScores = weekData[wi]
							.filter((m: any) => (m.points ?? 0) > 0)
							.map((m: any) => ({
								team: rosterNameMap.get(m.roster_id) ?? `Roster ${m.roster_id}`,
								pts: m.points ?? 0,
							}));
						if (weekScores.length) {
							weekScores.sort((a: any, b: any) => b.pts - a.pts);
							allWeekHighs.push({ season: yr, week, team: weekScores[0].team, pts: weekScores[0].pts });
						}
					}
				}

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
				atHighs = [...allWeekHighs].sort((a, b) => b.pts - a.pts).slice(0, 5);

				curId = leagueData.previous_league_id ?? '';
			}

			atLoaded = true;
		} catch (e: any) {
			atError = e.message;
		} finally {
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
	<div class="flex gap-1 mb-6 bg-gray-800/50 rounded-lg p-1 w-fit">
		<button
			onclick={() => switchTab('season')}
			class="px-4 py-1.5 rounded-md text-sm font-medium transition-colors
			       {tab === 'season' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}"
		>
			{season || 'This Season'}
		</button>
		<button
			onclick={() => switchTab('alltime')}
			class="px-4 py-1.5 rounded-md text-sm font-medium transition-colors
			       {tab === 'alltime' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}"
		>
			All Time
		</button>
	</div>

	<!-- ── Season tab ──────────────────────────────────────────────────────────── -->
	{#if tab === 'season'}
		{#if loading}
			<div class="grid sm:grid-cols-2 gap-6">
				{#each Array(4) as _}
					<div class="h-48 bg-gray-800 rounded-xl animate-pulse"></div>
				{/each}
			</div>
		{:else if error}
			<p class="text-red-400">Failed to load records: {error}</p>
		{:else}
			<div class="grid sm:grid-cols-2 gap-6">

				<!-- Season PF Leaders -->
				<section class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
					<h2 class="px-4 py-3 text-sm font-semibold text-gray-300 border-b border-gray-800 bg-gray-800/40">
						🏆 Season Points Leaders
					</h2>
					<div>
						{#each seasonLeaders.slice(0, 8) as team, i}
							<div class="flex items-center gap-3 px-4 py-2.5 {i % 2 === 0 ? '' : 'bg-gray-800/30'}">
								<span class="text-gray-600 text-xs w-4">{i + 1}</span>
								{#if team.avatar}
									<img src={team.avatar} alt="" class="w-7 h-7 rounded-full object-cover shrink-0" />
								{:else}
									<div class="w-7 h-7 rounded-full bg-gray-700 shrink-0"></div>
								{/if}
								<span class="text-sm text-gray-200 flex-1 truncate">{team.team}</span>
								<span class="font-mono text-sm font-semibold text-white">{team.fpts.toFixed(2)}</span>
							</div>
						{/each}
					</div>
				</section>

				<!-- Biggest Blowouts -->
				<section class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
					<h2 class="px-4 py-3 text-sm font-semibold text-gray-300 border-b border-gray-800 bg-gray-800/40">
						💥 Biggest Blowouts
					</h2>
					{#if blowouts.length === 0}
						<p class="px-4 py-3 text-sm text-gray-500">No completed games yet.</p>
					{:else}
						<div>
							{#each blowouts as g, i}
								<div class="px-4 py-2.5 {i % 2 === 0 ? '' : 'bg-gray-800/30'}">
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-white font-medium truncate">{g.winner}</span>
										<span class="font-mono text-white ml-2 shrink-0">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-gray-400 truncate">{g.loser}</span>
										<span class="font-mono text-gray-400 ml-2 shrink-0">{g.loserPts.toFixed(2)}</span>
									</div>
									<p class="text-xs text-gray-600 mt-0.5">Week {g.week} · margin: <span class="text-orange-400">{g.diff}</span></p>
								</div>
							{/each}
						</div>
					{/if}
				</section>

				<!-- Weekly Highs -->
				<section class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
					<h2 class="px-4 py-3 text-sm font-semibold text-gray-300 border-b border-gray-800 bg-gray-800/40">
						🔥 Highest Single-Week Scores
					</h2>
					{#if weekHighs.length === 0}
						<p class="px-4 py-3 text-sm text-gray-500">No completed games yet.</p>
					{:else}
						<div>
							{#each weekHighs as h, i}
								<div class="flex items-center gap-3 px-4 py-2.5 {i % 2 === 0 ? '' : 'bg-gray-800/30'}">
									<span class="text-gray-600 text-xs w-4">{i + 1}</span>
									<span class="text-sm text-gray-200 flex-1 truncate">{h.team}</span>
									<span class="text-xs text-gray-500 shrink-0">Wk {h.week}</span>
									<span class="font-mono text-sm font-semibold text-green-400 ml-2">{h.pts.toFixed(2)}</span>
								</div>
							{/each}
						</div>
					{/if}
				</section>

				<!-- Closest Games -->
				<section class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
					<h2 class="px-4 py-3 text-sm font-semibold text-gray-300 border-b border-gray-800 bg-gray-800/40">
						🤏 Closest Games
					</h2>
					{#if closest.length === 0}
						<p class="px-4 py-3 text-sm text-gray-500">No completed games yet.</p>
					{:else}
						<div>
							{#each closest as g, i}
								<div class="px-4 py-2.5 {i % 2 === 0 ? '' : 'bg-gray-800/30'}">
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-white font-medium truncate">{g.winner}</span>
										<span class="font-mono text-white ml-2 shrink-0">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-gray-400 truncate">{g.loser}</span>
										<span class="font-mono text-gray-400 ml-2 shrink-0">{g.loserPts.toFixed(2)}</span>
									</div>
									<p class="text-xs text-gray-600 mt-0.5">Week {g.week} · margin: <span class="text-blue-400">{g.diff}</span></p>
								</div>
							{/each}
						</div>
					{/if}
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
			<section class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden mb-6">
				<div class="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-gray-800/40">
					<h2 class="text-sm font-semibold text-gray-300">📊 All-Time Standings</h2>
					{#if atLoading}
						<span class="text-xs text-gray-500 animate-pulse">{atStatus}</span>
					{/if}
				</div>
				{#if atManagers.length === 0 && atLoading}
					<div class="h-48 animate-pulse bg-gray-800/30"></div>
				{:else if atManagers.length === 0}
					<p class="px-4 py-3 text-sm text-gray-500">No history found.</p>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b border-gray-800 text-gray-500 text-xs uppercase">
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
									<tr class="border-b border-gray-800/50 hover:bg-gray-800/30">
										<td class="px-4 py-2.5">
											<div class="flex items-center gap-2">
												<span class="text-gray-600 text-xs w-4 shrink-0">{i + 1}</span>
												{#if m.avatar}
													<img src={m.avatar} alt="" class="w-6 h-6 rounded-full object-cover shrink-0" />
												{:else}
													<div class="w-6 h-6 rounded-full bg-gray-700 shrink-0"></div>
												{/if}
												<span class="text-gray-200 truncate max-w-[120px]">{m.displayName}</span>
											</div>
										</td>
										<td class="px-3 py-2.5 text-right font-mono text-gray-300 whitespace-nowrap">
											{m.wins}–{m.losses}{m.ties ? `–${m.ties}` : ''}
										</td>
										<td class="px-3 py-2.5 text-right text-gray-400">{winPct(m)}%</td>
										<td class="px-3 py-2.5 text-right font-mono text-gray-300">{m.fpts.toFixed(0)}</td>
										<td class="px-3 py-2.5 text-right text-gray-500 hidden sm:table-cell">{fptsPerGame(m)}</td>
										<td class="px-3 py-2.5 text-right text-gray-600 hidden md:table-cell">{m.fptsAgainst.toFixed(0)}</td>
										<td class="px-3 py-2.5 text-right text-gray-600 hidden md:table-cell">{m.seasons}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					{#if atLoading}
						<p class="px-4 py-2 text-xs text-gray-600 animate-pulse border-t border-gray-800">{atStatus}</p>
					{/if}
				{/if}
			</section>

			<!-- All-time game records -->
			<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">

				<!-- All-time weekly highs -->
				<section class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
					<h2 class="px-4 py-3 text-sm font-semibold text-gray-300 border-b border-gray-800 bg-gray-800/40">
						🔥 All-Time High Scores
					</h2>
					{#if atHighs.length === 0 && atLoading}
						<div class="h-32 animate-pulse bg-gray-800/30"></div>
					{:else if atHighs.length === 0}
						<p class="px-4 py-3 text-sm text-gray-500">No data yet.</p>
					{:else}
						<div>
							{#each atHighs as h, i}
								<div class="flex items-center gap-3 px-4 py-2.5 {i % 2 === 0 ? '' : 'bg-gray-800/30'}">
									<span class="text-gray-600 text-xs w-4">{i + 1}</span>
									<span class="text-sm text-gray-200 flex-1 truncate">{h.team}</span>
									<span class="text-xs text-gray-500 shrink-0">{h.season} Wk{h.week}</span>
									<span class="font-mono text-sm font-semibold text-green-400 ml-1">{h.pts.toFixed(2)}</span>
								</div>
							{/each}
						</div>
					{/if}
				</section>

				<!-- All-time blowouts -->
				<section class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
					<h2 class="px-4 py-3 text-sm font-semibold text-gray-300 border-b border-gray-800 bg-gray-800/40">
						💥 All-Time Blowouts
					</h2>
					{#if atBlowouts.length === 0 && atLoading}
						<div class="h-32 animate-pulse bg-gray-800/30"></div>
					{:else if atBlowouts.length === 0}
						<p class="px-4 py-3 text-sm text-gray-500">No data yet.</p>
					{:else}
						<div>
							{#each atBlowouts as g, i}
								<div class="px-4 py-2.5 {i % 2 === 0 ? '' : 'bg-gray-800/30'}">
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-white font-medium truncate">{g.winner}</span>
										<span class="font-mono text-white ml-2 shrink-0">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-gray-400 truncate">{g.loser}</span>
										<span class="font-mono text-gray-400 ml-2 shrink-0">{g.loserPts.toFixed(2)}</span>
									</div>
									<p class="text-xs text-gray-600 mt-0.5">{g.season} Wk{g.week} · <span class="text-orange-400">{g.diff}</span></p>
								</div>
							{/each}
						</div>
					{/if}
				</section>

				<!-- All-time closest games -->
				<section class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
					<h2 class="px-4 py-3 text-sm font-semibold text-gray-300 border-b border-gray-800 bg-gray-800/40">
						🤏 All-Time Closest Games
					</h2>
					{#if atClosest.length === 0 && atLoading}
						<div class="h-32 animate-pulse bg-gray-800/30"></div>
					{:else if atClosest.length === 0}
						<p class="px-4 py-3 text-sm text-gray-500">No data yet.</p>
					{:else}
						<div>
							{#each atClosest as g, i}
								<div class="px-4 py-2.5 {i % 2 === 0 ? '' : 'bg-gray-800/30'}">
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-white font-medium truncate">{g.winner}</span>
										<span class="font-mono text-white ml-2 shrink-0">{g.winnerPts.toFixed(2)}</span>
									</div>
									<div class="flex justify-between items-baseline text-sm">
										<span class="text-gray-400 truncate">{g.loser}</span>
										<span class="font-mono text-gray-400 ml-2 shrink-0">{g.loserPts.toFixed(2)}</span>
									</div>
									<p class="text-xs text-gray-600 mt-0.5">{g.season} Wk{g.week} · <span class="text-blue-400">{g.diff}</span></p>
								</div>
							{/each}
						</div>
					{/if}
				</section>

			</div>
		{/if}
	{/if}
</div>
