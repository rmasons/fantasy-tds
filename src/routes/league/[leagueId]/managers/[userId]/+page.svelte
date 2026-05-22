<script lang="ts">
	import type { PageData } from './$types';
	import { fetchLeague, fetchRosters, fetchUsers, buildRosterInfoMap, combineFpts } from '$lib/sleeper';
	import type { ManagerProfile, ManagerLeagueProfile } from '$lib/types';

	let { data } = $props<{ data: PageData }>();

	interface SeasonStat {
		season: string;
		teamName: string;
		wins: number;
		losses: number;
		ties: number;
		fpts: number;
		fptsAgainst: number;
		rosterId: number;
	}

	interface ManagerInfo {
		ownerId: string;
		displayName: string;
		teamName: string;
		avatar: string | null;
	}

	let manager = $state<ManagerInfo | null>(null);
	let seasons = $state<SeasonStat[]>([]);
	let loading = $state(true);
	let loadingStatus = $state('Loading…');
	let error = $state('');

	let profile = $state<ManagerProfile | null>(null);
	let leagueProfile = $state<ManagerLeagueProfile | null>(null);

	$effect(() => {
		const leagueId = data.leagueId;
		const userId = data.userId;
		manager = null;
		seasons = [];
		profile = null;
		leagueProfile = null;
		loading = true;
		loadingStatus = 'Loading…';
		error = '';

		(async () => {
			try {
				// Load Sleeper data and profile in parallel
				const [, profileRes] = await Promise.all([
					(async () => {
						let curId: string | null = leagueId;
						const result: SeasonStat[] = [];

						while (curId && curId !== '0') {
							const [leagueData, users, rosters] = await Promise.all([
								fetchLeague(curId),
								fetchUsers(curId),
								fetchRosters(curId),
							]);

							if (data.leagueId !== leagueId || data.userId !== userId) return;

							loadingStatus = `Loaded ${leagueData.season}…`;

							const rosterInfo = buildRosterInfoMap(rosters, users);
							const roster = rosters.find(r => r.owner_id === userId);

							if (roster) {
								const info = rosterInfo.get(roster.roster_id)!;
								if (!manager) {
									manager = {
										ownerId: userId,
										displayName: info.ownerName ?? info.teamName,
										teamName: info.teamName,
										avatar: info.avatar,
									};
								}

								result.push({
									season: leagueData.season,
									teamName: info.teamName,
									wins: roster.settings?.wins ?? 0,
									losses: roster.settings?.losses ?? 0,
									ties: roster.settings?.ties ?? 0,
									fpts: combineFpts(roster.settings?.fpts, roster.settings?.fpts_decimal),
									fptsAgainst: combineFpts(roster.settings?.fpts_against, roster.settings?.fpts_against_decimal),
									rosterId: roster.roster_id,
								});
							}

							curId = leagueData.previous_league_id ?? null;
						}

						if (data.leagueId !== leagueId || data.userId !== userId) return;
						seasons = result;
					})(),
					fetch(`/api/profile/${userId}?leagueId=${leagueId}`)
						.then(r => r.json())
						.catch(() => ({ global: null, league: null })),
				]);

				if (data.leagueId !== leagueId || data.userId !== userId) return;
				profile = profileRes?.global ?? null;
				leagueProfile = profileRes?.league ?? null;
			} catch (e: any) {
				if (data.leagueId !== leagueId || data.userId !== userId) return;
				error = e.message;
			} finally {
				if (data.leagueId !== leagueId || data.userId !== userId) return;
				loading = false;
			}
		})();
	});

	const careerWins = $derived(seasons.reduce((s, x) => s + x.wins, 0));
	const careerLosses = $derived(seasons.reduce((s, x) => s + x.losses, 0));
	const careerTies = $derived(seasons.reduce((s, x) => s + x.ties, 0));
	const careerFpts = $derived(seasons.reduce((s, x) => s + x.fpts, 0));
	const careerGames = $derived(careerWins + careerLosses + careerTies);
	const winPct = $derived(careerGames > 0 ? ((careerWins + careerTies * 0.5) / careerGames * 100).toFixed(1) : '—');

	// Show edit button only if the logged-in user owns this profile
	const isOwnProfile = $derived(
		!!(data as any).user?.sleeperUserId && (data as any).user.sleeperUserId === data.userId
	);
	const editHref = $derived(`/settings/profile?leagueId=${data.leagueId}`);

	const hasAnyProfile = $derived(
		!!(profile?.bio || profile?.location || profile?.favoriteNFLTeam ||
		   profile?.favoritePlayer || profile?.funFact || profile?.twitterHandle ||
		   leagueProfile?.joinedYear)
	);
</script>

<div>
	<!-- Back link -->
	<a href="/league/{data.leagueId}/managers" class="text-slate-500 hover:text-slate-300 text-sm mb-6 inline-flex items-center gap-1 transition-colors">
		← All Managers
	</a>

	{#if loading && !manager}
		<div class="space-y-3 mt-4">
			<div class="h-24 bg-slate-800 rounded-xl animate-pulse"></div>
			<div class="h-48 bg-slate-800 rounded-xl animate-pulse"></div>
			<p class="text-slate-500 text-sm">{loadingStatus}</p>
		</div>
	{:else if error}
		<p class="text-red-400 mt-4">Failed to load manager: {error}</p>
	{:else if manager}
		<!-- Manager header -->
		<div class="flex items-start gap-4 mt-4 mb-5 p-5 bg-slate-900 rounded-xl border border-slate-800">
			{#if manager.avatar}
				<img src={manager.avatar} alt="" class="w-20 h-20 rounded-full object-cover border-2 border-slate-700 shrink-0" />
			{:else}
				<div class="w-20 h-20 rounded-full bg-slate-700 flex items-center justify-center text-4xl shrink-0">🏈</div>
			{/if}
			<div class="flex-1 min-w-0">
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<h1 class="text-2xl font-bold text-white">{manager.teamName}</h1>
						<p class="text-slate-400 text-sm">{manager.displayName}</p>
					</div>
					{#if isOwnProfile}
						<a
							href={editHref}
							class="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-colors"
						>
							Edit Profile
						</a>
					{/if}
				</div>
				{#if careerGames > 0}
					<div class="flex flex-wrap gap-4 mt-2 text-sm">
						<span class="text-slate-300">{careerWins}–{careerLosses}{careerTies ? `–${careerTies}` : ''} career</span>
						<span class="text-slate-500">{winPct}% win rate</span>
						<span class="text-slate-500">{careerFpts.toFixed(2)} total pts</span>
					</div>
				{/if}
			</div>
		</div>

		<!-- Profile "About" card -->
		{#if hasAnyProfile}
			<div class="mb-5 p-5 bg-slate-900 rounded-xl border border-slate-800 space-y-3">
				<h2 class="text-sm font-semibold text-slate-400 uppercase tracking-wider">About</h2>

				{#if profile?.bio}
					<p class="text-slate-300 text-sm leading-relaxed">{profile.bio}</p>
				{/if}

				<div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
					{#if profile?.location}
						<div>
							<p class="text-xs text-slate-600 uppercase tracking-wider mb-0.5">Location</p>
							<p class="text-slate-300">{profile.location}</p>
						</div>
					{/if}
					{#if leagueProfile?.joinedYear}
						<div>
							<p class="text-xs text-slate-600 uppercase tracking-wider mb-0.5">In League Since</p>
							<p class="text-slate-300">{leagueProfile.joinedYear}</p>
						</div>
					{/if}
					{#if profile?.favoriteNFLTeam}
						<div>
							<p class="text-xs text-slate-600 uppercase tracking-wider mb-0.5">Favorite Team</p>
							<p class="text-slate-300">{profile.favoriteNFLTeam}</p>
						</div>
					{/if}
					{#if profile?.favoritePlayer}
						<div>
							<p class="text-xs text-slate-600 uppercase tracking-wider mb-0.5">Favorite Player</p>
							<p class="text-slate-300">{profile.favoritePlayer}</p>
						</div>
					{/if}
					{#if profile?.twitterHandle}
						<div>
							<p class="text-xs text-slate-600 uppercase tracking-wider mb-0.5">X / Twitter</p>
							<a
								href="https://x.com/{profile.twitterHandle}"
								target="_blank"
								rel="noopener noreferrer"
								class="text-blue-400 hover:text-blue-300 transition-colors"
							>@{profile.twitterHandle}</a>
						</div>
					{/if}
				</div>

				{#if profile?.funFact}
					<div class="mt-1 pt-3 border-t border-slate-800">
						<p class="text-xs text-slate-600 uppercase tracking-wider mb-1">Fun Fact</p>
						<p class="text-slate-300 text-sm italic">"{profile.funFact}"</p>
					</div>
				{/if}
			</div>
		{:else if isOwnProfile && !loading}
			<!-- Nudge empty-state for own profile -->
			<div class="mb-5 p-4 bg-slate-900 rounded-xl border border-dashed border-slate-700 flex items-center justify-between gap-4">
				<p class="text-slate-500 text-sm">Your profile is empty. Add a bio and some info to stand out.</p>
				<a
					href={editHref}
					class="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
				>
					Set up profile
				</a>
			</div>
		{/if}

		<!-- Season history -->
		{#if seasons.length > 0}
			<h2 class="text-lg font-semibold mb-3 text-slate-300">Season History</h2>
			<div class="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-slate-800 text-slate-500 text-xs uppercase">
							<th class="px-4 py-3 text-left">Season</th>
							<th class="px-4 py-3 text-left">Team Name</th>
							<th class="px-4 py-3 text-right">W–L{careerTies ? '–T' : ''}</th>
							<th class="px-4 py-3 text-right">PF</th>
							<th class="px-4 py-3 text-right hidden sm:table-cell">PA</th>
						</tr>
					</thead>
					<tbody>
						{#each seasons as s}
							<tr class="border-b border-slate-800/50 hover:bg-slate-800/30">
								<td class="px-4 py-3 font-mono text-slate-400">{s.season}</td>
								<td class="px-4 py-3 text-slate-200 truncate max-w-[140px]">{s.teamName}</td>
								<td class="px-4 py-3 text-right text-slate-300">
									{s.wins}–{s.losses}{s.ties ? `–${s.ties}` : ''}
								</td>
								<td class="px-4 py-3 text-right text-slate-400">{s.fpts.toFixed(2)}</td>
								<td class="px-4 py-3 text-right text-slate-600 hidden sm:table-cell">{s.fptsAgainst.toFixed(2)}</td>
							</tr>
						{/each}
					</tbody>
					{#if seasons.length > 1}
						<tfoot>
							<tr class="border-t border-slate-700 bg-slate-800/30">
								<td class="px-4 py-3 text-slate-500 text-xs uppercase font-medium" colspan="2">Career</td>
								<td class="px-4 py-3 text-right font-semibold text-slate-300">
									{careerWins}–{careerLosses}{careerTies ? `–${careerTies}` : ''}
								</td>
								<td class="px-4 py-3 text-right font-semibold text-slate-400">{careerFpts.toFixed(2)}</td>
								<td class="px-4 py-3 hidden sm:table-cell"></td>
							</tr>
						</tfoot>
					{/if}
				</table>
			</div>
			{#if loading}
				<p class="text-slate-600 text-xs mt-2">{loadingStatus}</p>
			{/if}
		{:else if !loading}
			<p class="text-slate-400">No season data found for this manager.</p>
		{/if}
	{/if}
</div>
