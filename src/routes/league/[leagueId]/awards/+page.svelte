<script lang="ts">
	import type { PageData } from './$types';
	import { onMount } from 'svelte';

	let { data } = $props<{ data: PageData }>();

	interface ManagerEntry {
		rosterId: number;
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
	let loading = $state(true);
	let loadingStatus = $state('Fetching league history…');
	let error = $state('');
	let selectedIdx = $state(0);

	function avatarUrl(hash: string | null) {
		return hash ? `https://sleepercdn.com/avatars/thumbs/${hash}` : null;
	}

	onMount(async () => {
		try {
			const leagueRes = await fetch(`https://api.sleeper.app/v1/league/${data.leagueId}`);
			const current = await leagueRes.json();

			let curId: string = current.status === 'complete'
				? current.league_id
				: current.previous_league_id;

			while (curId && curId !== '0') {
				const [leagueData, users, rosters, winners, losers] = await Promise.all([
					fetch(`https://api.sleeper.app/v1/league/${curId}`).then(r => r.json()),
					fetch(`https://api.sleeper.app/v1/league/${curId}/users`).then(r => r.json()),
					fetch(`https://api.sleeper.app/v1/league/${curId}/rosters`).then(r => r.json()),
					fetch(`https://api.sleeper.app/v1/league/${curId}/winners_bracket`).then(r => r.json()),
					fetch(`https://api.sleeper.app/v1/league/${curId}/losers_bracket`).then(r => r.json()),
				]);

				loadingStatus = `Loaded ${leagueData.season}…`;

				const userMap = new Map<string, any>((users as any[]).map(u => [u.user_id, u]));
				const rosterUser = new Map<number, any>();
				for (const r of rosters as any[]) {
					const u = userMap.get(r.owner_id);
					if (u) rosterUser.set(r.roster_id, u);
				}

				function toEntry(rid: number): ManagerEntry {
					const u = rosterUser.get(rid);
					return {
						rosterId: rid,
						teamName: u?.metadata?.team_name ?? u?.display_name ?? `Team ${rid}`,
						ownerName: u?.display_name ?? `Team ${rid}`,
						avatar: avatarUrl(u?.avatar ?? null),
					};
				}

				const wb: any[] = Array.isArray(winners) ? winners : [];
				const lb: any[] = Array.isArray(losers) ? losers : [];

				if (wb.length > 0) {
					const playoffRounds = wb[wb.length - 1].r;
					const toiletRounds = lb.length ? lb[lb.length - 1].r : 0;

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

				curId = leagueData.previous_league_id;
			}
		} catch (e: any) {
			error = e.message;
		} finally {
			loading = false;
		}
	});

	const podium = $derived(podiums[selectedIdx]);
</script>

<div>
	<h1 class="text-2xl font-bold mb-6">Awards</h1>

	{#if loading && podiums.length === 0}
		<div class="space-y-3">
			{#each Array(3) as _}
				<div class="h-12 bg-gray-800 rounded-xl animate-pulse"></div>
			{/each}
			<p class="text-gray-500 text-sm">{loadingStatus}</p>
		</div>
	{:else if error}
		<p class="text-red-400">Failed to load awards: {error}</p>
	{:else if podiums.length === 0}
		<p class="text-gray-400">No completed seasons found.</p>
	{:else}
		<!-- Year tabs -->
		<div class="flex gap-1 bg-gray-900 rounded-xl p-1 mb-8 w-fit flex-wrap">
			{#each podiums as p, i}
				<button
					onclick={() => (selectedIdx = i)}
					class="px-4 py-1.5 rounded-lg text-sm font-medium transition-colors
					       {selectedIdx === i ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}"
				>
					{p.season}
				</button>
			{/each}
			{#if loading}
				<span class="px-4 py-1.5 text-xs text-gray-600 italic self-center">{loadingStatus}</span>
			{/if}
		</div>

		{#if podium}
			<!-- Champion's Cup -->
			<div class="mb-10">
				<p class="text-center text-gray-500 text-xs uppercase tracking-widest mb-6">
					{podium.season} Champion's Cup
				</p>

				<!-- Podium -->
				<div class="flex items-end justify-center gap-4 mb-8">
					<!-- 2nd place -->
					{#if podium.second}
						<div class="flex flex-col items-center gap-2">
							<div class="relative">
								{#if podium.second.avatar}
									<img src={podium.second.avatar} alt="" class="w-16 h-16 rounded-full object-cover border-2 border-gray-400" />
								{:else}
									<div class="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center text-2xl border-2 border-gray-400">🏈</div>
								{/if}
								<span class="absolute -bottom-1 -right-1 text-base">🥈</span>
							</div>
							<div class="text-center">
								<p class="text-sm font-semibold text-gray-300 max-w-[100px] truncate">{podium.second.teamName}</p>
								<p class="text-xs text-gray-500 max-w-[100px] truncate">{podium.second.ownerName}</p>
							</div>
							<div class="w-24 h-16 bg-gray-600 rounded-t-lg flex items-center justify-center">
								<span class="text-2xl font-bold text-gray-300">2</span>
							</div>
						</div>
					{/if}

					<!-- Champion -->
					<div class="flex flex-col items-center gap-2">
						<div class="text-3xl mb-1">🏆</div>
						<div class="relative">
							{#if podium.champion.avatar}
								<img src={podium.champion.avatar} alt="" class="w-24 h-24 rounded-full object-cover border-4 border-yellow-500 shadow-lg shadow-yellow-500/20" />
							{:else}
								<div class="w-24 h-24 rounded-full bg-gray-700 flex items-center justify-center text-4xl border-4 border-yellow-500">🏈</div>
							{/if}
							<span class="absolute -bottom-1 -right-1 text-xl">🥇</span>
						</div>
						<div class="text-center">
							<p class="text-base font-bold text-white max-w-[130px] truncate">{podium.champion.teamName}</p>
							<p class="text-sm text-gray-400 max-w-[130px] truncate">{podium.champion.ownerName}</p>
						</div>
						<div class="w-28 h-24 bg-yellow-600/30 border border-yellow-600/50 rounded-t-lg flex items-center justify-center">
							<span class="text-3xl font-bold text-yellow-500">1</span>
						</div>
					</div>

					<!-- 3rd place -->
					{#if podium.third}
						<div class="flex flex-col items-center gap-2">
							<div class="relative">
								{#if podium.third.avatar}
									<img src={podium.third.avatar} alt="" class="w-14 h-14 rounded-full object-cover border-2 border-orange-700" />
								{:else}
									<div class="w-14 h-14 rounded-full bg-gray-700 flex items-center justify-center text-xl border-2 border-orange-700">🏈</div>
								{/if}
								<span class="absolute -bottom-1 -right-1 text-base">🥉</span>
							</div>
							<div class="text-center">
								<p class="text-sm font-semibold text-gray-300 max-w-[90px] truncate">{podium.third.teamName}</p>
								<p class="text-xs text-gray-500 max-w-[90px] truncate">{podium.third.ownerName}</p>
							</div>
							<div class="w-20 h-12 bg-orange-900/40 rounded-t-lg flex items-center justify-center">
								<span class="text-xl font-bold text-orange-700">3</span>
							</div>
						</div>
					{/if}
				</div>

				<!-- Toilet Bowl -->
				{#if podium.toilet}
					<div class="mt-8 pt-6 border-t border-gray-800">
						<p class="text-center text-gray-500 text-xs uppercase tracking-widest mb-4">
							🚽 Toilet Bowl Champion
						</p>
						<div class="flex flex-col items-center gap-2">
							<div class="relative">
								{#if podium.toilet.avatar}
									<img src={podium.toilet.avatar} alt="" class="w-14 h-14 rounded-full object-cover border-2 border-gray-600 grayscale opacity-75" />
								{:else}
									<div class="w-14 h-14 rounded-full bg-gray-800 flex items-center justify-center text-xl border-2 border-gray-600">🏈</div>
								{/if}
							</div>
							<p class="text-sm text-gray-400">{podium.toilet.teamName}</p>
							<p class="text-xs text-gray-600">{podium.toilet.ownerName}</p>
						</div>
					</div>
				{/if}
			</div>

			<!-- All-time champions table -->
			<div class="mt-4">
				<h2 class="text-lg font-semibold mb-3 text-gray-300">All-Time Champions</h2>
				<div class="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b border-gray-800 text-gray-500 text-xs uppercase">
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
									class="border-b border-gray-800/50 cursor-pointer transition-colors
									       {selectedIdx === i ? 'bg-blue-900/20' : 'hover:bg-gray-800/50'}"
								>
									<td class="px-4 py-3 font-mono text-gray-400">{p.season}</td>
									<td class="px-4 py-3">
										<div class="flex items-center gap-2">
											{#if p.champion.avatar}
												<img src={p.champion.avatar} alt="" class="w-6 h-6 rounded-full" />
											{/if}
											<span class="text-white font-medium truncate max-w-[120px]">{p.champion.teamName}</span>
										</div>
									</td>
									<td class="px-4 py-3 text-gray-400 hidden sm:table-cell truncate max-w-[120px]">
										{p.second?.teamName ?? '—'}
									</td>
									<td class="px-4 py-3 text-gray-500 hidden md:table-cell truncate max-w-[120px]">
										{p.third?.teamName ?? '—'}
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
