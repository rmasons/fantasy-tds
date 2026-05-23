<script lang="ts">
	import type { PageData } from './$types';
	import type { ManagerProfile } from '$lib/types';
	import { fetchLeague, fetchLeagueCore, fetchWinnersBracket, fetchLosersBracket, buildRosterInfoMap, avatarUrl } from '$lib/sleeper';

	let { data } = $props<{ data: PageData }>();

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

	let podiums = $state<Podium[]>([]);
	let profiles = $state<Record<string, ManagerProfile>>({});
	let loading = $state(true);
	let loadingStatus = $state('Fetching league history…');
	let error = $state('');
	let selectedIdx = $state(0);

	function realName(entry: ManagerEntry): string {
		const p = profiles[entry.ownerId];
		const name = [p?.firstName, p?.lastName].filter(Boolean).join(' ');
		return name || entry.ownerName;
	}

	$effect(() => {
		const leagueId = data.leagueId;
		podiums = [];
		profiles = {};
		selectedIdx = 0;
		loading = true;
		loadingStatus = 'Fetching league history…';
		error = '';

		(async () => {
			try {
				const current = await fetchLeague(leagueId);

				if (data.leagueId !== leagueId) return;

				let curId: string | null = current.status === 'complete'
					? current.league_id
					: current.previous_league_id;

				while (curId && curId !== '0') {
					const [{ league: leagueData, rosters, users }, winners, losers] = await Promise.all([
						fetchLeagueCore(curId),
						fetchWinnersBracket(curId),
						fetchLosersBracket(curId),
					]);

					if (data.leagueId !== leagueId) return;

					loadingStatus = `Loaded ${leagueData.season}…`;

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

					curId = leagueData.previous_league_id ?? null;
				}

				// Fetch real names for all unique owners across all seasons
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
						.catch(e => console.warn('[awards] profiles fetch failed:', e));
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

	const podium = $derived(podiums[selectedIdx]);
</script>

<div>
	<div class="mb-6">
		<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">Awards</h1>
	</div>

	{#if loading && podiums.length === 0}
		<div class="space-y-3">
			{#each Array(3) as _}
				<div class="h-12 bg-navy-850 rounded-lg animate-pulse"></div>
			{/each}
			<p class="text-navy-500 text-sm">{loadingStatus}</p>
		</div>
	{:else if error}
		<p class="text-red-400">Failed to load awards: {error}</p>
	{:else if podiums.length === 0}
		<p class="text-navy-500">No completed seasons found.</p>
	{:else}
		<!-- Season tabs -->
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
			{#if loading}
				<span class="px-4 py-2.5 text-xs text-navy-500 italic self-center">{loadingStatus}</span>
			{/if}
		</div>

		{#if podium}
			<!-- ── CHAMPION HERO ──────────────────────────────── -->
			<div class="relative rounded-xl overflow-hidden mb-8 border border-amber-500/25">
				<!-- Background layers -->
				<div class="absolute inset-0 bg-slate-900"></div>
				<div class="absolute inset-0 bg-gradient-to-b from-amber-500/12 via-transparent to-transparent"></div>
				<div class="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-amber-400/70 to-transparent"></div>

				<div class="relative py-10 px-6 flex flex-col items-center text-center gap-5">
					<!-- Label -->
					<p class="text-xs font-bold uppercase tracking-[0.2em] text-amber-400/90">
						{podium.season} Fantasy Champion
					</p>

					<!-- Avatar with gold glow -->
					<div class="relative">
						<div class="absolute inset-0 rounded-full blur-2xl bg-amber-400/25 scale-[2]"></div>
						{#if podium.champion.avatar}
							<img
								src={podium.champion.avatar}
								alt=""
								class="relative w-28 h-28 rounded-full object-cover border-4 border-amber-400 shadow-2xl shadow-amber-900/50"
							/>
						{:else}
							<div class="relative w-28 h-28 rounded-full bg-slate-700 border-4 border-amber-400 flex items-center justify-center text-5xl">
								🏈
							</div>
						{/if}
					</div>

					<!-- Name / team -->
					<div>
						<h2 class="text-3xl font-black italic text-white leading-tight">{realName(podium.champion)}</h2>
						<p class="text-slate-400 text-sm mt-1">{podium.champion.teamName}</p>
					</div>
				</div>
			</div>

			<!-- ── CHAMPION'S CUP PODIUM ─────────────────────── -->
			<div class="mb-10">
				<!-- Gold ribbon label -->
				<div class="flex items-center justify-center mb-6">
					<div class="relative">
						<div class="bg-gradient-to-r from-amber-600 to-amber-500 text-amber-950 text-sm font-black uppercase tracking-widest px-8 py-2 rounded-sm shadow-lg">
							Champion's Cup
						</div>
						<!-- Ribbon tails -->
						<div class="absolute top-0 -left-3 w-3 h-full bg-amber-700" style="clip-path: polygon(100% 0, 100% 100%, 0 50%)"></div>
						<div class="absolute top-0 -right-3 w-3 h-full bg-amber-700" style="clip-path: polygon(0 0, 0 100%, 100% 50%)"></div>
					</div>
				</div>

				<!-- Podium with teams -->
				<div class="flex items-end justify-center gap-4">
					<!-- 2nd place -->
					{#if podium.second}
						<div class="flex flex-col items-center gap-2">
							<div class="relative">
								{#if podium.second.avatar}
									<img src={podium.second.avatar} alt="" class="w-16 h-16 rounded-full object-cover border-2 border-slate-400 shadow-md" />
								{:else}
									<div class="w-16 h-16 rounded-full bg-slate-700 flex items-center justify-center text-2xl border-2 border-slate-400">🏈</div>
								{/if}
								<span class="absolute -bottom-1 -right-1 text-base leading-none">🥈</span>
							</div>
							<div class="text-center">
								<p class="text-sm font-semibold text-slate-300 max-w-[100px] truncate">{realName(podium.second)}</p>
								<p class="text-xs text-slate-500 max-w-[100px] truncate">{podium.second.teamName}</p>
							</div>
							<div class="w-24 h-16 bg-gradient-to-b from-slate-500 to-slate-600 rounded-t-md flex items-center justify-center shadow-inner">
								<span class="text-2xl font-black text-slate-200">2</span>
							</div>
						</div>
					{/if}

					<!-- Champion (tallest pedestal) -->
					<div class="flex flex-col items-center gap-2">
						<div class="text-3xl mb-1 drop-shadow-lg">🏆</div>
						<div class="relative">
							<div class="absolute inset-0 rounded-full blur-xl bg-amber-400/20 scale-150"></div>
							{#if podium.champion.avatar}
								<img src={podium.champion.avatar} alt="" class="relative w-24 h-24 rounded-full object-cover border-4 border-amber-400 shadow-2xl shadow-amber-900/40" />
							{:else}
								<div class="relative w-24 h-24 rounded-full bg-slate-700 flex items-center justify-center text-4xl border-4 border-amber-400">🏈</div>
							{/if}
						</div>
						<div class="text-center">
							<p class="text-base font-bold text-white max-w-[130px] truncate">{realName(podium.champion)}</p>
							<p class="text-sm text-slate-400 max-w-[130px] truncate">{podium.champion.teamName}</p>
						</div>
						<div class="w-28 h-24 bg-gradient-to-b from-amber-600/40 to-amber-800/30 border border-amber-500/40 rounded-t-md flex items-center justify-center shadow-inner">
							<span class="text-3xl font-black text-amber-400">1</span>
						</div>
					</div>

					<!-- 3rd place -->
					{#if podium.third}
						<div class="flex flex-col items-center gap-2">
							<div class="relative">
								{#if podium.third.avatar}
									<img src={podium.third.avatar} alt="" class="w-14 h-14 rounded-full object-cover border-2 border-amber-700 shadow-md" />
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

			<!-- ── TOILET BOWL ──────────────────────────────── -->
			{#if podium.toilet}
				<div class="mt-4 pt-6 border-t border-slate-800">
					<div class="flex items-center justify-center mb-4">
						<div class="relative">
							<div class="bg-slate-800 border border-slate-600 text-slate-300 text-sm font-bold uppercase tracking-widest px-8 py-2 rounded-sm shadow">
								🚽 Toilet Bowl
							</div>
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

			<!-- ── ALL-TIME CHAMPIONS ─────────────────────────── -->
			<div class="mt-10">
				<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-3 flex items-center gap-2"><span class="text-amber-400">◆</span>All-Time Champions</h2>
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
</div>
