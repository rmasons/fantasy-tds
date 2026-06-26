<script lang="ts">
	import type { PageData } from './$types';
	import type { ManagerOption } from '$lib/server/rivalry';
	import type { DigestItem } from '$lib/server/rivalryDigest';

	let { data } = $props<{ data: PageData }>();

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

	interface SeasonGroup {
		season: string;
		record: { one: number; two: number; ties: number };
		matchups: H2HMatchup[];
	}

	let managers = $state<ManagerOption[]>(data.managers);
	let userOneId = $state('');
	let userTwoId = $state('');
	let rivalry = $state<Rivalry | null>(null);
	let analysing = $state(false);
	let analyseStatus = $state('');
	const loadingManagers = false;
	let error = $state(data.loadFailed ? 'Failed to load managers.' : '');

	const digest = $derived((data.digest ?? []) as DigestItem[]);
	const digestWeek = $derived(data.digestWeek as number | null);

	// Reset to the route league's server-rendered managers on navigation.
	$effect(() => {
		managers = data.managers;
		userOneId = '';
		userTwoId = '';
		rivalry = null;
		error = data.loadFailed ? 'Failed to load managers.' : '';
	});

	// Auto-analyze as soon as two distinct managers are selected — no button click
	// required. Depends only on the two ids, so it fires once per selection change
	// (the guard inside analyzeRivalry no-ops on incomplete/identical picks).
	$effect(() => {
		if (userOneId && userTwoId && userOneId !== userTwoId) {
			analyzeRivalry();
		}
	});

	async function analyzeRivalry() {
		if (!userOneId || !userTwoId || userOneId === userTwoId) return;
		analysing = true;
		rivalry = null;
		error = '';
		analyseStatus = 'Analyzing matchup history…';

		try {
			const res = await fetch(`/api/rivalry/${data.leagueId}?one=${userOneId}&two=${userTwoId}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			rivalry = await res.json();
		} catch (e: any) {
			error = e.message;
		} finally {
			analysing = false;
		}
	}

	const managerOne = $derived(managers.find(m => m.userId === userOneId));
	const managerTwo = $derived(managers.find(m => m.userId === userTwoId));
	const totalMatchups = $derived((rivalry?.wins.one ?? 0) + (rivalry?.wins.two ?? 0) + (rivalry?.ties ?? 0));

	const seasonGroups = $derived.by((): SeasonGroup[] => {
		if (!rivalry) return [];
		const map = new Map<string, SeasonGroup>();
		for (const m of rivalry.matchups) {
			if (!map.has(m.season)) map.set(m.season, { season: m.season, record: { one: 0, two: 0, ties: 0 }, matchups: [] });
			const g = map.get(m.season)!;
			g.matchups.push(m);
			if (m.teamOne.points > m.teamTwo.points) g.record.one++;
			else if (m.teamTwo.points > m.teamOne.points) g.record.two++;
			else g.record.ties++;
		}
		return [...map.values()].sort((a, b) => parseInt(b.season) - parseInt(a.season));
	});

	const highlights = $derived.by(() => {
		if (!rivalry || rivalry.matchups.length === 0) return null;

		let biggestWinGame = rivalry.matchups[0];
		let biggestWinMargin = 0;
		let closestGame = rivalry.matchups[0];
		let closestMargin = Infinity;

		for (const m of rivalry.matchups) {
			const margin = Math.abs(m.teamOne.points - m.teamTwo.points);
			if (margin > biggestWinMargin) { biggestWinGame = m; biggestWinMargin = margin; }
			if (margin < closestMargin) { closestGame = m; closestMargin = margin; }
		}

		let streak = 0;
		let streakWinner: 'one' | 'two' | 'tie' = 'tie';
		const first = rivalry.matchups[0];
		if (first) {
			streakWinner = first.teamOne.points > first.teamTwo.points ? 'one'
				: first.teamTwo.points > first.teamOne.points ? 'two' : 'tie';
			for (const m of rivalry.matchups) {
				const w = m.teamOne.points > m.teamTwo.points ? 'one'
					: m.teamTwo.points > m.teamOne.points ? 'two' : 'tie';
				if (w === streakWinner) streak++;
				else break;
			}
		}

		const biggestWinWinner = biggestWinGame.teamOne.points > biggestWinGame.teamTwo.points ? 'one' : 'two';
		return { biggestWinGame, biggestWinMargin, biggestWinWinner, closestGame, closestMargin, streak, streakWinner };
	});
</script>

<div>
	<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none mb-6">Rivalry</h1>

	<!-- ── This week's digest ──────────────────────────────────────── -->
	{#if digest.length > 0}
		<div class="mb-8">
			<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-3 flex items-center gap-2">
				<span class="text-amber-400">◆</span>
				This Week's Grudge Matches
				{#if digestWeek}
					<span class="text-navy-500 normal-case font-sans font-normal tracking-normal text-[11px]">· Week {digestWeek}</span>
				{/if}
			</h2>
			<div class="space-y-3">
				{#each digest as item, i}
					<div class="bg-navy-850 rounded-lg border border-navy-700 p-4">
						<!-- Rank badge + headline row -->
						<div class="flex items-start gap-3">
							<span class="shrink-0 mt-0.5 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold
							             {i === 0 ? 'bg-amber-500 text-navy-900' : 'bg-navy-800 text-navy-400'}">
								{i + 1}
							</span>
							<div class="flex-1 min-w-0">
								<!-- Manager names -->
								<div class="flex items-center gap-2 mb-1.5 flex-wrap">
									<div class="flex items-center gap-1.5">
										{#if item.managerOne.avatar}
											<img src={item.managerOne.avatar} alt="" class="w-5 h-5 rounded-full" />
										{:else}
											<div class="w-5 h-5 rounded-full bg-navy-800 flex items-center justify-center text-[9px]">🏈</div>
										{/if}
										<span class="text-sm font-semibold text-white">{item.managerOne.teamName}</span>
									</div>
									<span class="text-navy-500 text-xs">vs</span>
									<div class="flex items-center gap-1.5">
										{#if item.managerTwo.avatar}
											<img src={item.managerTwo.avatar} alt="" class="w-5 h-5 rounded-full" />
										{:else}
											<div class="w-5 h-5 rounded-full bg-navy-800 flex items-center justify-center text-[9px]">🏈</div>
										{/if}
										<span class="text-sm font-semibold text-white">{item.managerTwo.teamName}</span>
									</div>
								</div>
								<!-- Headline -->
								<p class="text-amber-400 font-sport font-bold text-sm uppercase tracking-wide leading-snug">
									{item.headline}
								</p>
								<!-- Subline -->
								{#if item.subline}
									<p class="text-slate-400 text-xs mt-0.5">{item.subline}</p>
								{/if}
								<!-- Signal pills -->
								{#if item.signals.length > 0}
									<div class="flex flex-wrap gap-1 mt-2">
										{#each item.signals as signal}
											<span class="px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide font-bold
											             {signal === 'tied_series' ? 'bg-amber-500/10 text-amber-400' :
											              signal === 'revenge_game' ? 'bg-red-500/10 text-red-400' :
											              signal === 'streak_on_the_line' ? 'bg-green-500/10 text-green-400' :
											              signal === 'first_meeting' ? 'bg-sky-500/10 text-sky-400' :
											              'bg-navy-800 text-navy-400'}">
												{signal.replace(/_/g, ' ')}
											</span>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- ── Rivalry analyzer ────────────────────────────────────────── -->
	<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-4 flex items-center gap-2">
		<span class="text-amber-400">◆</span>Analyze Any Rivalry
	</h2>

	{#if loadingManagers}
		<div class="h-20 bg-navy-850 rounded-lg animate-pulse"></div>
	{:else}
		<!-- Manager selectors -->
		<div class="grid sm:grid-cols-2 gap-4 mb-6">
			{#each [
				{ label: 'Manager 1', val: userOneId, other: userTwoId, set: (v: string) => { userOneId = v; rivalry = null; } },
				{ label: 'Manager 2', val: userTwoId, other: userOneId, set: (v: string) => { userTwoId = v; rivalry = null; } },
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
						{#if mgr}
							<div class="flex items-center gap-2 mt-3">
								{#if mgr.avatar}
									<img src={mgr.avatar} alt="" class="w-8 h-8 rounded-full" />
								{:else}
									<div class="w-8 h-8 rounded-full bg-navy-800 flex items-center justify-center text-base">🏈</div>
								{/if}
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
				<div class="bg-navy-850 rounded-lg border border-navy-700 overflow-hidden mb-5">
					<!-- Names header -->
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
						{ label: 'Wins',     one: rivalry.wins.one,   two: rivalry.wins.two,   fmt: (v: number) => String(v) },
						{ label: 'Win %',    one: rivalry.wins.one / totalMatchups, two: rivalry.wins.two / totalMatchups, fmt: (v: number) => (v * 100).toFixed(0) + '%' },
						{ label: 'Total Pts', one: rivalry.points.one, two: rivalry.points.two, fmt: (v: number) => v.toFixed(1) },
						{ label: 'Avg/Game', one: rivalry.points.one / totalMatchups, two: rivalry.points.two / totalMatchups, fmt: (v: number) => v.toFixed(1) },
					] as stat}
						<div class="grid grid-cols-3 border-b border-navy-700/50 last:border-b-0 items-center">
							<div class="p-3 text-center">
								<span class="text-lg font-bold tabular-nums
								             {stat.one > stat.two ? 'text-green-400' : stat.one < stat.two ? 'text-navy-500' : 'text-slate-300'}">
									{stat.fmt(stat.one)}
								</span>
							</div>
							<div class="p-3 text-center">
								<span class="text-[10px] text-navy-500 uppercase tracking-widest">{stat.label}</span>
							</div>
							<div class="p-3 text-center">
								<span class="text-lg font-bold tabular-nums
								             {stat.two > stat.one ? 'text-green-400' : stat.two < stat.one ? 'text-navy-500' : 'text-slate-300'}">
									{stat.fmt(stat.two)}
								</span>
							</div>
						</div>
					{/each}

					{#if rivalry.ties > 0}
						<div class="p-2.5 text-center text-xs text-navy-500 border-t border-navy-700/50">
							{rivalry.ties} tie{rivalry.ties !== 1 ? 's' : ''}
						</div>
					{/if}
				</div>

				<!-- Highlights -->
				{#if highlights}
					<div class="grid grid-cols-3 gap-3 mb-6">
						<div class="bg-navy-850 rounded-lg border border-navy-700 p-3 text-center">
							<p class="text-[9px] text-navy-500 uppercase tracking-widest mb-1.5">Biggest Win</p>
							<p class="text-xl font-bold text-white tabular-nums">+{highlights.biggestWinMargin.toFixed(1)}</p>
							<p class="text-[11px] text-amber-400/80 font-semibold mt-0.5 truncate">
								{highlights.biggestWinWinner === 'one' ? managerOne.teamName : managerTwo.teamName}
							</p>
							<p class="text-[10px] text-navy-600">{highlights.biggestWinGame.season} Wk {highlights.biggestWinGame.week}</p>
						</div>
						<div class="bg-navy-850 rounded-lg border border-navy-700 p-3 text-center">
							<p class="text-[9px] text-navy-500 uppercase tracking-widest mb-1.5">Closest Game</p>
							<p class="text-xl font-bold text-white tabular-nums">+{highlights.closestMargin.toFixed(2)}</p>
							<p class="text-[11px] text-navy-500 mt-0.5">margin</p>
							<p class="text-[10px] text-navy-600">{highlights.closestGame.season} Wk {highlights.closestGame.week}</p>
						</div>
						<div class="bg-navy-850 rounded-lg border border-navy-700 p-3 text-center">
							<p class="text-[9px] text-navy-500 uppercase tracking-widest mb-1.5">Streak</p>
							{#if highlights.streakWinner === 'tie'}
								<p class="text-xl font-bold text-navy-500">T{highlights.streak}</p>
							{:else}
								<p class="text-xl font-bold text-green-400 tabular-nums">W{highlights.streak}</p>
								<p class="text-[11px] text-slate-400 mt-0.5 truncate">
									{highlights.streakWinner === 'one' ? managerOne.teamName : managerTwo.teamName}
								</p>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Per-season matchup history -->
				<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-3 flex items-center gap-2">
					<span class="text-amber-400">◆</span>Matchup History ({totalMatchups})
				</h2>

				<div class="space-y-4">
					{#each seasonGroups as sg}
						<div>
							<div class="flex items-center gap-3 mb-2">
								<span class="font-sport font-bold text-sm text-white">{sg.season}</span>
								<span class="text-xs text-navy-500">
									{sg.record.one}–{sg.record.two}{sg.record.ties > 0 ? `–${sg.record.ties}` : ''}
									<span class="text-navy-700 mx-1">·</span>
									{sg.matchups.length} game{sg.matchups.length !== 1 ? 's' : ''}
								</span>
							</div>
							<div class="space-y-1.5">
								{#each sg.matchups as m}
									{@const oneWon = m.teamOne.points > m.teamTwo.points}
									{@const twoWon = m.teamTwo.points > m.teamOne.points}
									<div class="bg-navy-850 rounded-lg border border-navy-700 px-4 py-2.5 grid grid-cols-3 items-center text-sm">
										<div class="flex items-center gap-2">
											<span class="text-base font-bold tabular-nums {oneWon ? 'text-white' : 'text-slate-500'}">{m.teamOne.points.toFixed(2)}</span>
											{#if oneWon}<span class="text-[11px] font-bold text-green-500">W</span>
											{:else if !twoWon}<span class="text-[11px] font-bold text-yellow-600">T</span>{/if}
										</div>
										<div class="text-center">
											<p class="text-[10px] text-navy-600 uppercase tracking-widest">Wk {m.week}</p>
										</div>
										<div class="flex items-center justify-end gap-2">
											{#if twoWon}<span class="text-[11px] font-bold text-green-500">W</span>
											{:else if !oneWon}<span class="text-[11px] font-bold text-yellow-600">T</span>{/if}
											<span class="text-base font-bold tabular-nums {twoWon ? 'text-white' : 'text-slate-500'}">{m.teamTwo.points.toFixed(2)}</span>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	{/if}
</div>
