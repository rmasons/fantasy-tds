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

	const isOwnProfile = $derived(
		!!(data as any).user?.sleeperUserId && (data as any).user.sleeperUserId === data.userId
	);
	const isAdmin = $derived(!!(data as any).isAdmin);
	const editHref = $derived(`/settings/profile?leagueId=${data.leagueId}`);

	const hasAnyProfile = $derived(
		!!(profile?.bio || profile?.location || profile?.favoriteNFLTeam ||
		   profile?.favoritePlayer || profile?.funFact || profile?.twitterHandle ||
		   leagueProfile?.joinedYear)
	);

	// Commissioner edit state
	let commishEditing = $state(false);
	let commishSaving = $state(false);
	let commishError = $state('');
	let commishSuccess = $state(false);

	let ceFirstName = $state('');
	let ceLastName = $state('');
	let ceBio = $state('');
	let ceLocation = $state('');
	let ceFavoriteNFLTeam = $state('');
	let ceFavoritePlayer = $state('');
	let ceFunFact = $state('');
	let ceTwitterHandle = $state('');
	let ceJoinedYear = $state('');

	function openCommishEdit() {
		ceFirstName = profile?.firstName ?? '';
		ceLastName = profile?.lastName ?? '';
		ceBio = profile?.bio ?? '';
		ceLocation = profile?.location ?? '';
		ceFavoriteNFLTeam = profile?.favoriteNFLTeam ?? '';
		ceFavoritePlayer = profile?.favoritePlayer ?? '';
		ceFunFact = profile?.funFact ?? '';
		ceTwitterHandle = profile?.twitterHandle ?? '';
		ceJoinedYear = leagueProfile?.joinedYear?.toString() ?? '';
		commishError = '';
		commishSuccess = false;
		commishEditing = true;
	}

	async function saveCommishEdit() {
		commishSaving = true;
		commishError = '';
		commishSuccess = false;
		try {
			const res = await fetch(
				`/api/profile/${data.userId}?leagueId=${data.leagueId}`,
				{
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						firstName: ceFirstName,
						lastName: ceLastName,
						bio: ceBio,
						location: ceLocation,
						favoriteNFLTeam: ceFavoriteNFLTeam,
						favoritePlayer: ceFavoritePlayer,
						funFact: ceFunFact,
						twitterHandle: ceTwitterHandle,
						joinedYear: ceJoinedYear ? parseInt(ceJoinedYear, 10) : null,
					}),
				}
			);
			if (!res.ok) {
				const d = await res.json().catch(() => ({}));
				throw new Error(d.message ?? `HTTP ${res.status}`);
			}
			// Refresh profile
			const refreshed = await fetch(`/api/profile/${data.userId}?leagueId=${data.leagueId}`).then(r => r.json());
			profile = refreshed?.global ?? null;
			leagueProfile = refreshed?.league ?? null;
			commishSuccess = true;
			commishEditing = false;
			setTimeout(() => { commishSuccess = false; }, 3000);
		} catch (e: any) {
			commishError = e.message;
		} finally {
			commishSaving = false;
		}
	}
</script>

<div>
	<!-- Back link -->
	<a href="/league/{data.leagueId}/managers" class="text-slate-500 hover:text-slate-300 text-sm mb-6 inline-flex items-center gap-1 transition-colors">
		← All Managers
	</a>

	{#if loading && !manager}
		<div class="space-y-3 mt-4">
			<div class="h-24 bg-navy-850 rounded-lg animate-pulse"></div>
			<div class="h-48 bg-navy-850 rounded-lg animate-pulse"></div>
			<p class="text-navy-500 text-sm">{loadingStatus}</p>
		</div>
	{:else if error}
		<p class="text-red-400 mt-4">Failed to load manager: {error}</p>
	{:else if manager}
		<!-- Manager header -->
		<div class="flex items-start gap-4 mt-4 mb-5 p-5 bg-navy-850 rounded-lg border border-navy-700">
			{#if manager.avatar}
				<img src={manager.avatar} alt="" class="w-20 h-20 rounded-full object-cover border-2 border-slate-700 shrink-0" />
			{:else}
				<div class="w-20 h-20 rounded-full bg-slate-700 flex items-center justify-center text-4xl shrink-0">🏈</div>
			{/if}
			<div class="flex-1 min-w-0">
				<div class="flex items-start justify-between gap-3">
					<div class="min-w-0">
						<h1 class="text-2xl font-bold text-white">{manager.teamName}</h1>
						{#if profile?.firstName || profile?.lastName}
							<p class="text-slate-200 text-sm font-medium">{[profile.firstName, profile.lastName].filter(Boolean).join(' ')}</p>
						{/if}
						<p class="text-slate-400 text-sm">{manager.displayName}</p>
					</div>
					<div class="flex items-center gap-2 shrink-0">
						{#if isOwnProfile}
							<a
								href={editHref}
								class="text-xs px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition-colors"
							>
								Edit Profile
							</a>
						{/if}
						{#if isAdmin}
							<button
								onclick={openCommishEdit}
								class="text-xs px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 transition-colors"
							>
								Commissioner Edit
							</button>
						{/if}
					</div>
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

		<!-- Commissioner edit form -->
		{#if commishEditing}
			<div class="mb-5 p-5 bg-navy-850 rounded-lg border border-amber-500/30 space-y-4">
				<div class="flex items-center justify-between">
					<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-amber-400 flex items-center gap-2"><span>◆</span>Commissioner Edit</h2>
					<button onclick={() => commishEditing = false} class="text-slate-500 hover:text-white text-xs">Cancel</button>
				</div>

				{#if commishError}
					<p class="text-red-400 text-sm">{commishError}</p>
				{/if}

				<div class="grid sm:grid-cols-2 gap-3">
					<div>
						<label class="block text-xs text-navy-500 mb-1">First Name</label>
						<input type="text" maxlength="50" bind:value={ceFirstName} placeholder="First" class="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-2 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500" />
					</div>
					<div>
						<label class="block text-xs text-navy-500 mb-1">Last Name</label>
						<input type="text" maxlength="50" bind:value={ceLastName} placeholder="Last" class="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-2 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500" />
					</div>
				</div>

				<div>
					<label class="block text-xs text-navy-500 mb-1">Bio</label>
					<textarea rows="2" maxlength="280" bind:value={ceBio} placeholder="Bio…" class="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-2 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500 resize-none"></textarea>
				</div>

				<div class="grid sm:grid-cols-2 gap-3">
					<div>
						<label class="block text-xs text-navy-500 mb-1">Location</label>
						<input type="text" maxlength="60" bind:value={ceLocation} placeholder="City, State" class="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-2 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500" />
					</div>
					<div>
						<label class="block text-xs text-navy-500 mb-1">In League Since</label>
						<input type="number" min="1990" max="2100" bind:value={ceJoinedYear} placeholder="e.g. 2018" class="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-2 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500" />
					</div>
				</div>

				<div class="grid sm:grid-cols-2 gap-3">
					<div>
						<label class="block text-xs text-navy-500 mb-1">Favorite NFL Team</label>
						<input type="text" maxlength="60" bind:value={ceFavoriteNFLTeam} placeholder="e.g. Kansas City Chiefs" class="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-2 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500" />
					</div>
					<div>
						<label class="block text-xs text-navy-500 mb-1">Favorite Player</label>
						<input type="text" maxlength="60" bind:value={ceFavoritePlayer} placeholder="e.g. Justin Jefferson" class="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-2 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500" />
					</div>
				</div>

				<div>
					<label class="block text-xs text-navy-500 mb-1">Fun Fact / Trash Talk</label>
					<input type="text" maxlength="200" bind:value={ceFunFact} placeholder="One thing your league needs to know…" class="w-full bg-navy-800 border border-navy-700 rounded-lg px-3 py-2 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500" />
				</div>

				<div>
					<label class="block text-xs text-navy-500 mb-1">X / Twitter Handle</label>
					<div class="flex items-center">
						<span class="bg-navy-900 border border-r-0 border-navy-700 rounded-l-lg px-3 py-2 text-navy-500 text-sm select-none">@</span>
						<input type="text" maxlength="50" bind:value={ceTwitterHandle} placeholder="yourhandle" class="flex-1 bg-navy-800 border border-navy-700 rounded-r-lg px-3 py-2 text-sm text-white placeholder-navy-500 focus:outline-none focus:border-amber-500" />
					</div>
				</div>

				<div class="pt-1">
					<button
						onclick={saveCommishEdit}
						disabled={commishSaving}
						class="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:opacity-50 rounded-lg text-sm font-semibold transition-colors"
					>
						{commishSaving ? 'Saving…' : 'Save'}
					</button>
				</div>
			</div>
		{/if}

		{#if commishSuccess}
			<div class="mb-5 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-300 text-sm">
				Profile updated.
			</div>
		{/if}

		<!-- Profile "About" card -->
		{#if hasAnyProfile}
			<div class="mb-5 p-5 bg-navy-850 rounded-lg border border-navy-700 space-y-3">
				<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 flex items-center gap-2"><span class="text-amber-400">◆</span>About</h2>

				{#if profile?.bio}
					<p class="text-slate-300 text-sm leading-relaxed">{profile.bio}</p>
				{/if}

				{#if isAdmin && profile?.email}
					<p class="text-xs text-amber-400/60 font-mono">{profile.email}</p>
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
							<p class="text-xs text-navy-500 uppercase tracking-wider mb-0.5">X / Twitter</p>
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
			<div class="mb-5 p-4 bg-navy-850 rounded-lg border border-dashed border-navy-700 flex items-center justify-between gap-4">
				<p class="text-navy-500 text-sm">Your profile is empty. Add a bio and some info to stand out.</p>
				<a
					href={editHref}
					class="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold transition-colors"
				>
					Set up profile
				</a>
			</div>
		{/if}

		<!-- Season history -->
		{#if seasons.length > 0}
			<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-3 flex items-center gap-2"><span class="text-amber-400">◆</span>Season History</h2>
			<div class="bg-navy-850 rounded-lg border border-navy-700 overflow-hidden">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-navy-700 text-navy-500 text-[10px] uppercase tracking-wider">
							<th class="px-4 py-3 text-left">Season</th>
							<th class="px-4 py-3 text-left">Team Name</th>
							<th class="px-4 py-3 text-right">W–L{careerTies ? '–T' : ''}</th>
							<th class="px-4 py-3 text-right">PF</th>
							<th class="px-4 py-3 text-right hidden sm:table-cell">PA</th>
						</tr>
					</thead>
					<tbody>
						{#each seasons as s}
							<tr class="border-b border-navy-700/50 hover:bg-navy-800">
								<td class="px-4 py-3 font-mono text-navy-500 tabular-nums">{s.season}</td>
								<td class="px-4 py-3 text-slate-200 truncate max-w-[140px]">{s.teamName}</td>
								<td class="px-4 py-3 text-right text-slate-300 tabular-nums">
									{s.wins}–{s.losses}{s.ties ? `–${s.ties}` : ''}
								</td>
								<td class="px-4 py-3 text-right text-slate-400 tabular-nums">{s.fpts.toFixed(2)}</td>
								<td class="px-4 py-3 text-right text-navy-500 hidden sm:table-cell tabular-nums">{s.fptsAgainst.toFixed(2)}</td>
							</tr>
						{/each}
					</tbody>
					{#if seasons.length > 1}
						<tfoot>
							<tr class="border-t border-navy-700 bg-navy-900">
								<td class="px-4 py-3 text-navy-500 text-xs uppercase font-medium tracking-wider" colspan="2">Career</td>
								<td class="px-4 py-3 text-right font-semibold text-slate-300 tabular-nums">
									{careerWins}–{careerLosses}{careerTies ? `–${careerTies}` : ''}
								</td>
								<td class="px-4 py-3 text-right font-semibold text-slate-400 tabular-nums">{careerFpts.toFixed(2)}</td>
								<td class="px-4 py-3 hidden sm:table-cell"></td>
							</tr>
						</tfoot>
					{/if}
				</table>
			</div>
			{#if loading}
				<p class="text-navy-500 text-xs mt-2">{loadingStatus}</p>
			{/if}
		{:else if !loading}
			<p class="text-navy-500">No season data found for this manager.</p>
		{/if}
	{/if}
</div>
