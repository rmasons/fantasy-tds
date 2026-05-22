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
	<h1 class="text-2xl font-bold mb-6">Rivalry</h1>

	{#if loadingManagers}
		<div class="h-20 bg-slate-800 rounded-xl animate-pulse"></div>
	{:else}
		<!-- Manager selectors -->
		<div class="grid sm:grid-cols-2 gap-4 mb-6">
			{#each [
				{ label: 'Manager 1', bind: 'one', val: userOneId, other: userTwoId, set: (v: string) => { userOneId = v; rivalry = null; } },
				{ label: 'Manager 2', bind: 'two', val: userTwoId, other: userOneId, set: (v: string) => { userTwoId = v; rivalry = null; } },
			] as sel}
				<div class="bg-slate-900 rounded-xl border border-slate-800 p-4">
					<p class="text-xs text-slate-500 uppercase tracking-wider mb-2">{sel.label}</p>
					<select
						value={sel.val}
						onchange={(e) => sel.set((e.target as HTMLSelectElement).value)}
						class="w-full bg-slate-800 text-slate-200 rounded-lg px-3 py-2 text-sm border border-slate-700 focus:outline-none focus:border-blue-500"
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
			class="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed
			       text-white text-sm font-medium rounded-lg transition-colors mb-8"
		>
			{analysing ? analyseStatus : 'Analyze Rivalry'}
		</button>

		{#if error}
			<p class="text-red-400">{error}</p>
		{/if}

		{#if rivalry && managerOne && managerTwo}
			{#if totalMatchups === 0}
				<p class="text-slate-400">These managers have never faced each other.</p>
			{:else}
				<!-- Scoreboard -->
				<div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden mb-6">
					<!-- Header: names -->
					<div class="grid grid-cols-3 border-b border-slate-800">
						<div class="flex flex-col items-center gap-1 p-4 border-r border-slate-800">
							{#if managerOne.avatar}
								<img src={managerOne.avatar} alt="" class="w-10 h-10 rounded-full" />
							{:else}
								<div class="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">🏈</div>
							{/if}
							<p class="text-sm font-semibold text-white text-center truncate max-w-[100px]">{managerOne.teamName}</p>
						</div>
						<div class="flex items-center justify-center">
							<span class="text-slate-500 text-sm font-medium">vs</span>
						</div>
						<div class="flex flex-col items-center gap-1 p-4 border-l border-slate-800">
							{#if managerTwo.avatar}
								<img src={managerTwo.avatar} alt="" class="w-10 h-10 rounded-full" />
							{:else}
								<div class="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">🏈</div>
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
						<div class="grid grid-cols-3 border-b border-slate-800/50 items-center">
							<div class="p-3 text-center">
								<span class="text-lg font-bold {oneNum > twoNum ? 'text-green-400' : oneNum < twoNum ? 'text-slate-500' : 'text-slate-300'}">{stat.one}</span>
							</div>
							<div class="p-3 text-center">
								<span class="text-xs text-slate-500">{stat.label}</span>
							</div>
							<div class="p-3 text-center">
								<span class="text-lg font-bold {twoNum > oneNum ? 'text-green-400' : twoNum < oneNum ? 'text-slate-500' : 'text-slate-300'}">{stat.two}</span>
							</div>
						</div>
					{/each}

					{#if rivalry.ties > 0}
						<div class="p-3 text-center text-xs text-slate-600">
							{rivalry.ties} tie{rivalry.ties !== 1 ? 's' : ''}
						</div>
					{/if}
				</div>

				<!-- Matchup history -->
				<h2 class="text-base font-semibold mb-3 text-slate-300">Matchup History ({totalMatchups})</h2>
				<div class="space-y-2">
					{#each rivalry.matchups as m}
						{@const oneWon = m.teamOne.points > m.teamTwo.points}
						{@const twoWon = m.teamTwo.points > m.teamOne.points}
						<div class="bg-slate-900 rounded-xl border border-slate-800 px-4 py-3 grid grid-cols-3 items-center text-sm">
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
