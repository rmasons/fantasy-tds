<script lang="ts">
	import type { PageData } from './$types';
	import { fetchRosters, fetchUsers, fetchLeague, fetchMatchups as fetchWeekMatchups, buildRosterInfoMap } from '$lib/sleeper';

	let { data } = $props<{ data: PageData }>();

	interface ManagerOption {
		userId: string;
		displayName: string;
		teamName: string;
		avatar: string | null;
	}

	interface H2HMatchup {
		season: string;
		week: number;
		teamOne: { points: number };
		teamTwo: { points: number };
	}

	interface Rivalry {
		wins: { one: number; two: number };
		ties: number;
		points: { one: number; two: number };
		matchups: H2HMatchup[];
	}

	let managers = $state<ManagerOption[]>([]);
	let userOneId = $state('');
	let userTwoId = $state('');
	let rivalry = $state<Rivalry | null>(null);
	let analysing = $state(false);
	let analyseStatus = $state('');
	let loadingManagers = $state(true);
	let error = $state('');

	$effect(() => {
		const leagueId = data.leagueId;
		managers = [];
		userOneId = '';
		userTwoId = '';
		rivalry = null;
		loadingManagers = true;
		error = '';

		(async () => {
			try {
				const [rosters, users] = await Promise.all([
					fetchRosters(leagueId),
					fetchUsers(leagueId),
				]);

				if (data.leagueId !== leagueId) return;

				const rosterInfo = buildRosterInfoMap(rosters, users);
				managers = rosters
					.filter(r => r.owner_id)
					.map(r => {
						const info = rosterInfo.get(r.roster_id)!;
						return {
							userId: r.owner_id,
							displayName: info.ownerName ?? info.teamName,
							teamName: info.teamName,
							avatar: info.avatar,
						};
					})
					.sort((a, b) => a.teamName.localeCompare(b.teamName));
			} catch (e: any) {
				if (data.leagueId !== leagueId) return;
				error = e.message;
			} finally {
				if (data.leagueId !== leagueId) return;
				loadingManagers = false;
			}
		})();
	});

	async function analyzeRivalry() {
		if (!userOneId || !userTwoId || userOneId === userTwoId) return;
		analysing = true;
		rivalry = null;
		error = '';

		try {
			let curId: string | null = data.leagueId;

			const result: Rivalry = { wins: { one: 0, two: 0 }, ties: 0, points: { one: 0, two: 0 }, matchups: [] };

			while (curId && curId !== '0') {
				analyseStatus = `Scanning season…`;

				const [leagueData, rosters] = await Promise.all([
					fetchLeague(curId),
					fetchRosters(curId),
				]);

				analyseStatus = `Scanning ${leagueData.season}…`;

				const rOne = (rosters as any[]).find(r => r.owner_id === userOneId)?.roster_id;
				const rTwo = (rosters as any[]).find(r => r.owner_id === userTwoId)?.roster_id;

				if (rOne && rTwo && rOne !== rTwo) {
					const playoffStart = leagueData.settings?.playoff_week_start ?? 15;
					const weekNums = Array.from({ length: playoffStart - 1 }, (_, i) => i + 1);

					const weekData: any[][] = await Promise.all(
						weekNums.map(w => fetchWeekMatchups(curId!, w))
					);

					for (let i = 0; i < weekData.length; i++) {
						const week = weekNums[i];
						const matchups: Record<number, any[]> = {};

						for (const m of weekData[i] ?? []) {
							if (m.roster_id === rOne || m.roster_id === rTwo) {
								if (!matchups[m.matchup_id]) matchups[m.matchup_id] = [];
								matchups[m.matchup_id].push(m);
							}
						}

						const keys = Object.keys(matchups);
						if (keys.length === 1) {
							const pair = matchups[parseInt(keys[0])];
							if (pair.length === 2) {
								// ensure pair[0] is rOne
								if (pair[0].roster_id !== rOne) pair.reverse();
								const ptsOne = pair[0].points ?? 0;
								const ptsTwo = pair[1].points ?? 0;

								result.points.one += ptsOne;
								result.points.two += ptsTwo;
								if (ptsOne > ptsTwo) result.wins.one++;
								else if (ptsTwo > ptsOne) result.wins.two++;
								else result.ties++;

								result.matchups.push({ season: leagueData.season, week, teamOne: { points: ptsOne }, teamTwo: { points: ptsTwo } });
							}
						}
					}
				}

				curId = leagueData.previous_league_id ?? null;
			}

			result.matchups.sort((a, b) => parseInt(b.season) - parseInt(a.season) || b.week - a.week);
			rivalry = result;
		} catch (e: any) {
			error = e.message;
		} finally {
			analysing = false;
		}
	}

	const managerOne = $derived(managers.find(m => m.userId === userOneId));
	const managerTwo = $derived(managers.find(m => m.userId === userTwoId));
	const totalMatchups = $derived((rivalry?.wins.one ?? 0) + (rivalry?.wins.two ?? 0) + (rivalry?.ties ?? 0));
</script>

<div>
	<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none mb-6">Rivalry</h1>

	{#if loadingManagers}
		<div class="h-20 bg-navy-850 rounded-lg animate-pulse"></div>
	{:else}
		<!-- Manager selectors -->
		<div class="grid sm:grid-cols-2 gap-4 mb-6">
			{#each [
				{ label: 'Manager 1', bind: 'one', val: userOneId, other: userTwoId, set: (v: string) => { userOneId = v; rivalry = null; } },
				{ label: 'Manager 2', bind: 'two', val: userTwoId, other: userOneId, set: (v: string) => { userTwoId = v; rivalry = null; } },
			] as sel}
				<div class="bg-navy-850 rounded-lg border border-navy-700 p-4">
					<p class="text-[10px] text-navy-500 uppercase tracking-widest mb-2">{sel.label}</p>
					<select
						value={sel.val}
						onchange={(e) => sel.set((e.target as HTMLSelectElement).value)}
						class="w-full bg-navy-800 text-slate-200 rounded-lg px-3 py-2 text-sm border border-navy-700 focus:outline-none focus:border-amber-500"
					>
						<option value="">Select manager…</option>
						{#each managers as m}
							<option value={m.userId} disabled={m.userId === sel.other}>{m.teamName} ({m.displayName})</option>
						{/each}
					</select>

					{#if sel.val}
						{@const mgr = managers.find(m => m.userId === sel.val)}
						{#if mgr?.avatar}
							<div class="flex items-center gap-2 mt-3">
								<img src={mgr.avatar} alt="" class="w-8 h-8 rounded-full" />
								<span class="text-sm text-slate-300">{mgr.teamName}</span>
							</div>
						{/if}
					{/if}
				</div>
			{/each}
		</div>

		<button
			onclick={analyzeRivalry}
			disabled={!userOneId || !userTwoId || userOneId === userTwoId || analysing}
			class="px-5 py-2 bg-amber-500 hover:bg-amber-400 disabled:bg-navy-800 disabled:text-navy-500 disabled:cursor-not-allowed
			       text-slate-900 font-sport font-bold uppercase tracking-wider text-sm rounded-lg transition-colors mb-8"
		>
			{analysing ? analyseStatus : 'Analyze Rivalry'}
		</button>

		{#if error}
			<p class="text-red-400">{error}</p>
		{/if}

		{#if rivalry && managerOne && managerTwo}
			{#if totalMatchups === 0}
				<p class="text-navy-500">These managers have never faced each other.</p>
			{:else}
				<!-- Scoreboard -->
				<div class="bg-navy-850 rounded-lg border border-navy-700 overflow-hidden mb-6">
					<!-- Header: names -->
					<div class="grid grid-cols-3 border-b border-navy-700">
						<div class="flex flex-col items-center gap-1 p-4 border-r border-navy-700">
							{#if managerOne.avatar}
								<img src={managerOne.avatar} alt="" class="w-10 h-10 rounded-full" />
							{:else}
								<div class="w-10 h-10 rounded-full bg-navy-800 flex items-center justify-center">🏈</div>
							{/if}
							<p class="text-sm font-semibold text-white text-center truncate max-w-[100px]">{managerOne.teamName}</p>
						</div>
						<div class="flex items-center justify-center">
							<span class="text-navy-500 text-sm font-medium">vs</span>
						</div>
						<div class="flex flex-col items-center gap-1 p-4 border-l border-navy-700">
							{#if managerTwo.avatar}
								<img src={managerTwo.avatar} alt="" class="w-10 h-10 rounded-full" />
							{:else}
								<div class="w-10 h-10 rounded-full bg-navy-800 flex items-center justify-center">🏈</div>
							{/if}
							<p class="text-sm font-semibold text-white text-center truncate max-w-[100px]">{managerTwo.teamName}</p>
						</div>
					</div>

					<!-- Stats rows -->
					{#each [
						{ label: 'Wins', one: rivalry.wins.one, two: rivalry.wins.two },
						{ label: 'Points', one: rivalry.points.one.toFixed(2), two: rivalry.points.two.toFixed(2) },
					] as stat}
						{@const oneNum = parseFloat(String(stat.one))}
						{@const twoNum = parseFloat(String(stat.two))}
						<div class="grid grid-cols-3 border-b border-navy-700/50 items-center">
							<div class="p-3 text-center">
								<span class="text-lg font-bold tabular-nums {oneNum > twoNum ? 'text-green-400' : oneNum < twoNum ? 'text-navy-500' : 'text-slate-300'}">{stat.one}</span>
							</div>
							<div class="p-3 text-center">
								<span class="text-[10px] text-navy-500 uppercase tracking-widest">{stat.label}</span>
							</div>
							<div class="p-3 text-center">
								<span class="text-lg font-bold tabular-nums {twoNum > oneNum ? 'text-green-400' : twoNum < oneNum ? 'text-navy-500' : 'text-slate-300'}">{stat.two}</span>
							</div>
						</div>
					{/each}

					{#if rivalry.ties > 0}
						<div class="p-3 text-center text-xs text-navy-500">
							{rivalry.ties} tie{rivalry.ties !== 1 ? 's' : ''}
						</div>
					{/if}
				</div>

				<!-- Matchup history -->
				<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-3 flex items-center gap-2"><span class="text-amber-400">◆</span>Matchup History ({totalMatchups})</h2>
				<div class="space-y-2">
					{#each rivalry.matchups as m}
						{@const oneWon = m.teamOne.points > m.teamTwo.points}
						{@const twoWon = m.teamTwo.points > m.teamOne.points}
						<div class="bg-navy-850 rounded-lg border border-navy-700 px-4 py-3 grid grid-cols-3 items-center text-sm">
							<div class="flex items-center gap-2">
								<span class="text-base font-bold {oneWon ? 'text-white' : 'text-slate-500'}">{m.teamOne.points.toFixed(2)}</span>
								{#if oneWon}<span class="text-xs text-green-500">W</span>{:else if !twoWon}<span class="text-xs text-yellow-600">T</span>{/if}
							</div>
							<div class="text-center">
								<p class="text-xs text-slate-500">{m.season} · Wk {m.week}</p>
							</div>
							<div class="flex items-center justify-end gap-2">
								{#if twoWon}<span class="text-xs text-green-500">W</span>{:else if !oneWon}<span class="text-xs text-yellow-600">T</span>{/if}
								<span class="text-base font-bold {twoWon ? 'text-white' : 'text-slate-500'}">{m.teamTwo.points.toFixed(2)}</span>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	{/if}
</div>
