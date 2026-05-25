<script lang="ts">
	import type { LayoutData } from '../$types';
	import type { SeasonRecords, RecordGame, RecordScore, ManagerProfile } from '$lib/types';
	import {
		fetchLeague, fetchLeagueCore, fetchWinnersBracket, fetchLosersBracket,
		fetchMatchups, buildRosterInfoMap, combineFpts,
	} from '$lib/sleeper';
	import FaabEasterEgg from '$lib/components/FaabEasterEgg.svelte';

	let { data } = $props<{ data: LayoutData }>();

	let tab = $state<'awards' | 'season' | 'alltime'>('awards');

	interface ManagerEntry {
		rosterId: number;
		ownerId: string;
		teamName: string;
		ownerName: string;
		avatar: string | null;
	}

	interface Podium {
		season: string;
		champion: ManagerEntry;
		second: ManagerEntry | null;
		third: ManagerEntry | null;
		toilet: ManagerEntry | null;
	}

	interface StatEntry {
		value: number;
		holder: ManagerEntry;
		opponent?: ManagerEntry;
		season: string;
		week?: number;
	}

	interface AllTimeStatRecords {
		highWeek: StatEntry | null;
		highSeason: StatEntry | null;
		lowSeason: StatEntry | null;
		blowout: StatEntry | null;
		narrowestWin: StatEntry | null;
		heartbreaker: StatEntry | null;
	}

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

	let podiums = $state<Podium[]>([]);
	let profiles = $state<Record<string, ManagerProfile>>({});
	let awardsLoading = $state(true);
	let awardsStatus = $state('Fetching league history…');
	let awardsError = $state('');
	let selectedIdx = $state(0);
	let statRecords = $state<AllTimeStatRecords | null>(null);
	let statRecordsLoading = $state(false);

	let blowouts = $state<RecordGame[]>([]);
	let closest = $state<RecordGame[]>([]);
	let weekHighs = $state<RecordScore[]>([]);
	let weekLows = $state<RecordScore[]>([]);
	let highCombined = $state<RecordGame[]>([]);
	let seasonLeaders = $state<{ team: string; avatar: string | null; fpts: number }[]>([]);
	let seasonYear = $state('');
	let seasonLoading = $state(true);
	let seasonError = $state('');

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

		tab = 'awards';
		podiums = [];
		profiles = {};
		selectedIdx = 0;
		awardsLoading = true;
		awardsStatus = 'Fetching league history…';
		awardsError = '';
		statRecords = null;
		statRecordsLoading = false;
		blowouts = [];
		closest = [];
		weekHighs = [];
		weekLows = [];
		highCombined = [];
		seasonLeaders = [];
		seasonYear = '';
		seasonLoading = true;
		seasonError = '';
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
				const current = await fetchLeague(leagueId);
				if (data.leagueId !== leagueId) return;

				let curId: string | null = current.status === 'complete'
					? current.league_id
					: current.previous_league_id;

				const seasonCache: Array<{
					lid: string;
					season: string;
					playoffStart: number;
					rInfo: Map<number, any>;
					rosters: any[];
				}> = [];

				while (curId && curId !== '0') {
					const [{ league: leagueData, rosters, users }, winners, losers] = await Promise.all([
						fetchLeagueCore(curId),
						fetchWinnersBracket(curId),
						fetchLosersBracket(curId),
					]);

					if (data.leagueId !== leagueId) return;

					awardsStatus = `Loaded ${leagueData.season}…`;

					const rosterInfo = buildRosterInfoMap(rosters, users);

					function toEntry(rid: number): ManagerEntry {
						const info = rosterInfo.get(rid);
						return {
							rosterId: rid,
							ownerId: info?.ownerId ?? '',
							teamName: info?.teamName ?? `Team ${rid}`,
							ownerName: info?.ownerName ?? info?.teamName ?? `Team ${rid}`,
							avatar: info?.avatar ?? null,
						};
					}

					const wb: any[] = Array.isArray(winners) ? winners : [];
					const lb: any[] = Array.isArray(losers) ? losers : [];

					if (wb.length > 0) {
						const playoffRounds = Math.max(...wb.map((m: any) => m.r));
						const toiletRounds = lb.length ? Math.max(...lb.map((m: any) => m.r)) : 0;

						const finalsMatch = wb.find(m => m.r === playoffRounds && m.t1_from?.w != null);
						const runnersUpMatch = wb.find(m => m.r === playoffRounds && m.t1_from?.l != null);
						const toiletMatch = lb.length
							? lb.find(m => m.r === toiletRounds && (!m.t1_from || m.t1_from?.w != null))
							: null;

						if (finalsMatch?.w) {
							podiums = [...podiums, {
								season: leagueData.season,
								champion: toEntry(finalsMatch.w),
								second: finalsMatch.l ? toEntry(finalsMatch.l) : null,
								third: runnersUpMatch?.w ? toEntry(runnersUpMatch.w) : null,
								toilet: toiletMatch?.w ? toEntry(toiletMatch.w) : null,
							}];
						}
					}

					seasonCache.push({
						lid: curId,
						season: leagueData.season,
						playoffStart: leagueData.settings?.playoff_week_start ?? 15,
						rInfo: rosterInfo,
						rosters,
					});

					curId = leagueData.previous_league_id ?? null;
				}

				if (data.leagueId !== leagueId) return;
				const ownerIds = [...new Set(
					podiums.flatMap(p => [p.champion, p.second, p.third, p.toilet])
						.filter((e): e is ManagerEntry => !!e && !!e.ownerId)
						.map(e => e.ownerId)
				)];
				if (ownerIds.length) {
					fetch(`/api/profiles?ids=${ownerIds.join(',')}`)
						.then(r => r.json())
						.then(p => { if (data.leagueId === leagueId) profiles = p; })
						.catch(() => {});
				}

				if (seasonCache.length === 0) return;

				statRecordsLoading = true;
				awardsStatus = 'Computing all-time records…';

				let _highWeek: StatEntry | null = null;
				let _highSeason: StatEntry | null = null;
				let _lowSeason: StatEntry | null = null;
				let _blowout: StatEntry | null = null;
				let _narrowestWin: StatEntry | null = null;
				let _heartbreaker: StatEntry | null = null;

				for (const sd of seasonCache) {
					for (const r of sd.rosters) {
						const gp = (r.settings?.wins ?? 0) + (r.settings?.losses ?? 0);
						if (gp === 0) continue;
						const fpts = combineFpts(r.settings?.fpts, r.settings?.fpts_decimal);
						const info = sd.rInfo.get(r.roster_id);
						if (!info) continue;
						const entry: ManagerEntry = {
							rosterId: r.roster_id,
							ownerId: info.ownerId ?? '',
							teamName: info.teamName ?? `Team ${r.roster_id}`,
							ownerName: info.ownerName ?? info.teamName ?? `Team ${r.roster_id}`,
							avatar: info.avatar ?? null,
						};
						if (!_highSeason || fpts > _highSeason.value) {
							_highSeason = { value: fpts, holder: entry, season: sd.season };
						}
						if (!_lowSeason || fpts < _lowSeason.value) {
							_lowSeason = { value: fpts, holder: entry, season: sd.season };
						}
					}
				}

				const weekFetches = seasonCache.flatMap(sd => {
					const weeks = Array.from({ length: sd.playoffStart - 1 }, (_, i) => i + 1);
					return weeks.map(w => ({ sd, w, promise: fetchMatchups(sd.lid, w).catch(() => []) }));
				});
				const weekResults = await Promise.all(weekFetches.map(f => f.promise));
				if (data.leagueId !== leagueId) return;

				for (let i = 0; i < weekFetches.length; i++) {
					const { sd, w } = weekFetches[i];
					const weekMatchups: any[] = weekResults[i] ?? [];

					const groups: Record<number, any[]> = {};
					for (const m of weekMatchups) {
						if (!m.matchup_id) continue;
						if (!groups[m.matchup_id]) groups[m.matchup_id] = [];
						groups[m.matchup_id].push(m);
					}

					for (const pair of Object.values(groups)) {
						if (pair.length !== 2) continue;
						const [a, b] = pair;
						const ptsA = a.points ?? 0;
						const ptsB = b.points ?? 0;
						if (ptsA === 0 && ptsB === 0) continue;

						const entry = (rid: number): ManagerEntry => {
							const info = sd.rInfo.get(rid);
							return {
								rosterId: rid,
								ownerId: info?.ownerId ?? '',
								teamName: info?.teamName ?? `Team ${rid}`,
								ownerName: info?.ownerName ?? info?.teamName ?? `Team ${rid}`,
								avatar: info?.avatar ?? null,
							};
						};

						if (ptsA > 0 && (!_highWeek || ptsA > _highWeek.value)) {
							_highWeek = { value: ptsA, holder: entry(a.roster_id), season: sd.season, week: w };
						}
						if (ptsB > 0 && (!_highWeek || ptsB > _highWeek.value)) {
							_highWeek = { value: ptsB, holder: entry(b.roster_id), season: sd.season, week: w };
						}

						if (ptsA !== ptsB) {
							const [winner, loser, wPts, lPts] = ptsA > ptsB
								? [a, b, ptsA, ptsB]
								: [b, a, ptsB, ptsA];
							const margin = wPts - lPts;

							if (!_blowout || margin > _blowout.value) {
								_blowout = { value: margin, holder: entry(winner.roster_id), opponent: entry(loser.roster_id), season: sd.season, week: w };
							}
							if (!_narrowestWin || margin < _narrowestWin.value) {
								_narrowestWin = { value: margin, holder: entry(winner.roster_id), opponent: entry(loser.roster_id), season: sd.season, week: w };
							}
							if (!_heartbreaker || lPts > _heartbreaker.value) {
								_heartbreaker = { value: lPts, holder: entry(loser.roster_id), opponent: entry(winner.roster_id), season: sd.season, week: w };
							}
						}
					}
				}

				if (data.leagueId !== leagueId) return;
				statRecords = { highWeek: _highWeek, highSeason: _highSeason, lowSeason: _lowSeason, blowout: _blowout, narrowestWin: _narrowestWin, heartbreaker: _heartbreaker };

			} catch (e: any) {
				if (data.leagueId !== leagueId) return;
				awardsError = e.message;
			} finally {
				if (data.leagueId !== leagueId) return;
				awardsLoading = false;
				statRecordsLoading = false;
			}
		})();

		(async () => {
			try {
				const res = await fetch(`/api/records/${leagueId}`);
				if (!res.ok) throw new Error(`Failed to load records: ${res.status}`);
				const result = await res.json() as SeasonRecords;

				if (data.leagueId !== leagueId) return;

				seasonYear = result.season;
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
				seasonError = e.message;
			} finally {
				if (data.leagueId !== leagueId) return;
				seasonLoading = false;
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

	function switchTab(t: 'awards' | 'season' | 'alltime') {
		tab = t;
		if (t === 'alltime') loadAllTime();
	}

	function realName(entry: ManagerEntry): string {
		const p = profiles[entry.ownerId];
		const name = [p?.firstName, p?.lastName].filter(Boolean).join(' ');
		return name || entry.ownerName;
	}

	function winPct(m: AllTimeStat) {
		const g = m.wins + m.losses + m.ties;
		return g > 0 ? ((m.wins + m.ties * 0.5) / g * 100).toFixed(1) : '—';
	}

	function fptsPerGame(m: AllTimeStat) {
		const g = m.wins + m.losses + m.ties;
		return g > 0 ? (m.fpts / g).toFixed(2) : '—';
	}

	const podium = $derived(podiums[selectedIdx]);

	const statRecordCards = $derived.by(() => {
		if (!statRecords) return [];
		return [
			{ title: 'Highest Single Week',   icon: '⚡', entry: statRecords.highWeek,     fmt: (v: number) => v.toFixed(2),        unit: 'pts',    ctx: (r: StatEntry) => `Wk ${r.week}, ${r.season}`, oppLabel: null },
			{ title: 'Best Season Total',      icon: '\u{1F4C8}', entry: statRecords.highSeason,   fmt: (v: number) => v.toFixed(2),        unit: 'pts',    ctx: (r: StatEntry) => r.season,                    oppLabel: null },
			{ title: 'Biggest Blowout',        icon: '\u{1F4A5}', entry: statRecords.blowout,      fmt: (v: number) => '+' + v.toFixed(2), unit: 'margin', ctx: (r: StatEntry) => `Wk ${r.week}, ${r.season}`, oppLabel: 'def.' },
			{ title: 'Narrowest Win',          icon: '\u{1F62C}', entry: statRecords.narrowestWin, fmt: (v: number) => '+' + v.toFixed(2), unit: 'margin', ctx: (r: StatEntry) => `Wk ${r.week}, ${r.season}`, oppLabel: 'def.' },
			{ title: 'Most Pts in a Loss',     icon: '\u{1F494}', entry: statRecords.heartbreaker, fmt: (v: number) => v.toFixed(2),        unit: 'pts',    ctx: (r: StatEntry) => `Wk ${r.week}, ${r.season}`, oppLabel: 'lost to' },
			{ title: 'Lowest Season Total',    icon: '\u{1F4C9}', entry: statRecords.lowSeason,    fmt: (v: number) => v.toFixed(2),        unit: 'pts',    ctx: (r: StatEntry) => r.season,                    oppLabel: null },
		].filter(c => c.entry !== null);
	});
</script>

<div>
	<div class="mb-5">
		<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">Records</h1>
		<p class="text-navy-500 text-[10px] uppercase tracking-[0.2em] font-semibold mt-1">Awards &amp; League Statistics</p>
	</div>

	<div class="flex mb-6 border-b border-navy-700">
		<button
			onclick={() => switchTab('awards')}
			class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
			       {tab === 'awards' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
		>
			Awards
		</button>
		<button
			onclick={() => switchTab('season')}
			class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
			       {tab === 'season' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
		>
			{seasonYear || 'Season'}
		</button>
		<button
			onclick={() => switchTab('alltime')}
			class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
			       {tab === 'alltime' ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
		>
			All Time<FaabEasterEgg eggId="2" />
		</button>
	</div>

	{#if tab === 'awards'}
		{#if awardsLoading && podiums.length === 0}
			<div class="space-y-3">
				{#each Array(3) as _}
					<div class="h-12 bg-navy-850 rounded-lg animate-pulse"></div>
				{/each}
				<p class="text-navy-500 text-sm">{awardsStatus}</p>
			</div>
		{:else if awardsError}
			<p class="text-red-400">Failed to load awards: {awardsError}</p>
		{:else if podiums.length === 0}
			<p class="text-navy-500">No completed seasons found.</p>
		{:else}
			<div class="flex mb-8 border-b border-navy-700 flex-wrap">
				{#each podiums as p, i}
					<button
						onclick={() => (selectedIdx = i)}
						class="px-5 py-2.5 font-sport font-bold uppercase text-sm tracking-wider -mb-px transition-colors
						       {selectedIdx === i ? 'text-amber-400 border-b-2 border-amber-400' : 'text-navy-500 hover:text-slate-300'}"
					>
						{p.season}
					</button>
				{/each}
				{#if awardsLoading || statRecordsLoading}
					<span class="px-4 py-2.5 text-xs text-navy-500 italic self-center">{awardsStatus}</span>
				{/if}
			</div>

			{#if podium}
				<div class="relative rounded-xl overflow-hidden mb-8 border border-amber-500/25">
					<div class="absolute inset-0 bg-slate-900"></div>
					<div class="absolute inset-0 bg-gradient-to-b from-amber-500/12 via-transparent to-transparent"></div>
					<div class="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-amber-400/70 to-transparent"></div>
					<div class="relative py-10 px-6 flex flex-col items-center text-center gap-5">
						<p class="text-xs font-bold uppercase tracking-[0.2em] text-amber-400/90">{podium.season} Fantasy Champion</p>
						<div class="relative">
							<div class="absolute inset-0 rounded-full blur-2xl bg-amber-400/25 scale-[2]"></div>
							{#if podium.champion.avatar}
								<img src={podium.champion.avatar} alt="" class="relative w-28 h-28 rounded-full object-cover border-4 border-amber-400" />
							{:else}
								<div class="relative w-28 h-28 rounded-full bg-slate-700 border-4 border-amber-400 flex items-center justify-center text-5xl">🏈</div>
							{/if}
						</div>
						<div>
							<h2 class="text-3xl font-black italic text-white leading-tight">{realName(podium.champion)}</h2>
							<p class="text-slate-400 text-sm mt-1">{podium.champion.teamName}</p>
						</div>
					</div>
				</div>

				<div class="mb-10">
					<div class="flex items-center justify-center mb-6">
						<div class="relative">
							<div class="bg-gradient-to-r from-amber-600 to-amber-500 text-amber-950 text-sm font-black uppercase tracking-widest px-8 py-2 rounded-sm">Champion's Cup</div>
							<div class="absolute top-0 -left-3 w-3 h-full bg-amber-700" style="clip-path: polygon(100% 0, 100% 100%, 0 50%)"></div>
							<div class="absolute top-0 -right-3 w-3 h-full bg-amber-700" style="clip-path: polygon(0 0, 0 100%, 100% 50%)"></div>
						</div>
					</div>
					<div class="flex items-end justify-center gap-4">
						{#if podium.second}
							<div class="flex flex-col items-center gap-2">
								<div class="relative">
									{#if podium.second.avatar}
										<img src={podium.second.avatar} alt="" class="w-16 h-16 rounded-full object-cover border-2 border-slate-400" />
									{:else}
										<div class="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center text-2xl border-2 border-slate-400">🏈</div>
									{/if}
									<span class="absolute -bottom-1 -right-1 text-base leading-none">🥈</span>
								</div>
								<div class="text-center">
									<p class="text-sm font-semibold text-slate-300 max-w-[100px] truncate">{realName(podium.second)}</p>
									<p class="text-xs text-slate-500 max-w-[100px] truncate">{podium.second.teamName}</p>
								</div>
								<div class="w-24 h-16 bg-gradient-to-b from-slate-500 to-slate-600 rounded-t-md flex items-center justify-center">
									<span class="text-2xl font-black text-slate-200">2</span>
								</div>
							</div>
						{/if}
						<div class="flex flex-col items-center gap-2">
							<div class="text-3xl mb-1 drop-shadow-lg">🏆</div>
							<div class="relative">
								<div class="absolute inset-0 rounded-full blur-xl bg-amber-400/20 scale-150"></div>
								{#if podium.champion.avatar}
									<img src={podium.champion.avatar} alt="" class="relative w-24 h-24 rounded-full object-cover border-4 border-amber-400" />
								{:else}
									<div class="relative w-24 h-24 rounded-full bg-slate-700 flex items-center justify-center text-4xl border-4 border-amber-400">🏈</div>
								{/if}
							</div>
							<div class="text-center">
								<p class="text-base font-bold text-white max-w-[130px] truncate">{realName(podium.champion)}</p>
								<p class="text-sm text-slate-400 max-w-[130px] truncate">{podium.champion.teamName}</p>
							</div>
							<div class="w-28 h-24 bg-gradient-to-b from-amber-600/40 to-amber-800/30 border border-amber-500/40 rounded-t-md flex items-center justify-center">
								<span class="text-3xl font-black text-amber-400">1</span>
							</div>
						</div>
						{#if podium.third}
							<div class="flex flex-col items-center gap-2">
								<div class="relative">
									{#if podium.third.avatar}
										<img src={podium.third.avatar} alt="" class="w-14 h-14 rounded-full object-cover border-2 border-amber-700" />
									{:else}
										<div class="w-14 h-14 rounded-full bg-slate-700 flex items-center justify-center text-xl border-2 border-amber-700">🏈</div>
									{/if}
									<span class="absolute -bottom-1 -right-1 text-base leading-none">🥉</span>
								</div>
								<div class="text-center">
									<p class="text-sm font-semibold text-slate-300 max-w-[90px] truncate">{realName(podium.third)}</p>
									<p class="text-xs text-slate-500 max-w-[90px] truncate">{podium.third.teamName}</p>
								</div>
								<div class="w-20 h-12 bg-gradient-to-b from-amber-900/50 to-amber-950/40 rounded-t-md flex items-center justify-center">
									<span class="text-xl font-black text-amber-700">3</span>
								</div>
							</div>
						{/if}
					</div>
				</div>

				{#if podium.toilet}
					<div class="mt-4 pt-6 border-t border-slate-800">
						<div class="flex items-center justify-center mb-4">
							<div class="relative">
								<div class="bg-slate-800 border border-slate-600 text-slate-300 text-sm font-bold uppercase tracking-widest px-8 py-2 rounded-sm shadow">🚽 Toilet Bowl</div>
								<div class="absolute top-0 -left-3 w-3 h-full bg-slate-700" style="clip-path: polygon(100% 0, 100% 100%, 0 50%)"></div>
								<div class="absolute top-0 -right-3 w-3 h-full bg-slate-700" style="clip-path: polygon(0 0, 0 100%, 100% 50%)"></div>
							</div>
						</div>
						<div class="flex flex-col items-center gap-2">
							<div class="relative">
								{#if podium.toilet.avatar}
									<img src={podium.toilet.avatar} alt="" class="w-14 h-14 rounded-full object-cover border-2 border-slate-600 grayscale opacity-70" />
								{:else}
									<div class="w-14 h-14 rounded-full bg-slate-800 flex items-center justify-center text-xl border-2 border-slate-600 grayscale opacity-70">🏈</div>
								{/if}
							</div>
							<p class="text-sm text-slate-400 font-medium">{realName(podium.toilet)}</p>
							<p class="text-xs text-slate-600">{podium.toilet.teamName}</p>
						</div>
					</div>
				{/if}
			{/if}

			<div class="mt-10">
				<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-4 flex items-center gap-2">
					<span class="text-amber-400">◆</span>All-Time Records
				</h2>
				{#if statRecordsLoading && !statRecords}
					<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
						{#each Array(6) as _}
							<div class="h-28 bg-navy-850 rounded-lg animate-pulse border border-navy-700"></div>
						{/each}
					</div>
				{:else if statRecordCards.length > 0}
					<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
						{#each statRecordCards as card}
							{#if card.entry}
								<div class="bg-navy-850 rounded-lg border border-navy-700 p-4 flex flex-col gap-2.5">
									<div class="flex items-start justify-between gap-1">
										<p class="text-[10px] text-navy-500 uppercase tracking-widest font-semibold leading-tight">{card.title}</p>
										<span class="text-lg shrink-0 leading-none">{card.icon}</span>
									</div>
									<div>
										<span class="text-2xl font-black tabular-nums text-white font-mono leading-none">{card.fmt(card.entry.value)}</span>
										<span class="text-xs text-navy-500 ml-1">{card.unit}</span>
									</div>
									<div class="flex items-center gap-2 min-w-0">
										{#if card.entry.holder.avatar}
											<img src={card.entry.holder.avatar} alt="" class="w-6 h-6 rounded-full shrink-0 object-cover" />
										{:else}
											<div class="w-6 h-6 rounded-full bg-navy-800 flex items-center justify-center text-xs shrink-0">🏈</div>
										{/if}
										<div class="min-w-0">
											<p class="text-sm font-semibold text-white truncate">{realName(card.entry.holder)}</p>
											<p class="text-xs text-navy-500 truncate">{card.ctx(card.entry)}</p>
										</div>
									</div>
									{#if card.oppLabel && card.entry.opponent}
										<p class="text-xs text-navy-500 truncate">{card.oppLabel} <span class="text-slate-400">{realName(card.entry.opponent)}</span></p>
									{/if}
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			</div>

			<div class="mt-10">
				<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-3 flex items-center gap-2">
					<span class="text-amber-400">◆</span>All-Time Champions
				</h2>
				<div class="bg-navy-850 rounded-lg border border-navy-700 overflow-hidden">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-navy-700 text-navy-500 text-[10px] uppercase tracking-wider">
								<th class="px-4 py-3 text-left">Season</th>
								<th class="px-4 py-3 text-left">Champion</th>
								<th class="px-4 py-3 text-left hidden sm:table-cell">Runner-up</th>
								<th class="px-4 py-3 text-left hidden md:table-cell">3rd Place</th>
							</tr>
						</thead>
						<tbody>
							{#each podiums as p, i}
								<tr
									onclick={() => (selectedIdx = i)}
									class="border-b border-navy-700/50 cursor-pointer transition-colors
									       {selectedIdx === i ? 'bg-amber-500/10' : 'hover:bg-navy-800'}"
								>
									<td class="px-4 py-3 font-mono text-slate-400">{p.season}</td>
									<td class="px-4 py-3">
										<div class="flex items-center gap-2">
											{#if p.champion.avatar}
												<img src={p.champion.avatar} alt="" class="w-6 h-6 rounded-full shrink-0" />
											{/if}
											<div class="min-w-0">
												<p class="text-white font-semibold truncate">{realName(p.champion)}</p>
												<p class="text-xs text-slate-600 truncate">{p.champion.teamName}</p>
											</div>
										</div>
									</td>
									<td class="px-4 py-3 hidden sm:table-cell">
										<p class="text-slate-400 truncate max-w-[120px]">{p.second ? realName(p.second) : '—'}</p>
										{#if p.second}<p class="text-xs text-slate-600 truncate max-w-[120px]">{p.second.teamName}</p>{/if}
									</td>
									<td class="px-4 py-3 hidden md:table-cell">
										<p class="text-slate-500 truncate max-w-[120px]">{p.third ? realName(p.third) : '—'}</p>
										{#if p.third}<p class="text-xs text-slate-600 truncate max-w-[120px]">{p.third.teamName}</p>{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	{/if}

	{#if tab === 'season'}
		{#if seasonLoading}
			<div class="grid sm:grid-cols-2 gap-5">
				{#each Array(4) as _}
					<div class="h-48 bg-navy-850 rounded-lg animate-pulse"></div>
				{/each}
			</div>
		{:else if seasonError}
			<p class="text-red-400">Failed to load records: {seasonError}</p>
		{:else}
			<div class="grid sm:grid-cols-2 gap-5">

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

	{#if tab === 'alltime'}
		{#if atError}
			<p class="text-red-400">Failed to load all-time records: {atError}</p>
		{:else}
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
										<td class="px-3 py-2.5 text-right font-mono text-slate-300 whitespace-nowrap tabular-nums">{m.wins}–{m.losses}{m.ties ? `–${m.ties}` : ''}</td>
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

			<div class="grid sm:grid-cols-2 gap-5">

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
