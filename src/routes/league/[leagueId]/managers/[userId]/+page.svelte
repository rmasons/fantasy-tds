<script lang="ts">
	import type { PageData } from './$types';
	import { fetchLeague, fetchRosters, fetchUsers, fetchWinnersBracket, buildRosterInfoMap, combineFpts } from '$lib/sleeper';
	import type { ManagerProfile, ManagerLeagueProfile } from '$lib/types';

	let { data } = $props<{ data: PageData }>();

	type PlayoffFinish = 'champion' | 'runner-up' | '3rd' | 'playoffs' | null;

	// Sleeper bracket match shape: https://docs.sleeper.com/#get-winners-bracket-for-a-league
	interface BracketMatch {
		r: number;
		t1: number | null;
		t2: number | null;
		w: number | null;
		t1_from?: { w?: number; l?: number };
		t2_from?: { w?: number; l?: number };
	}

	interface SeasonStat {
		season: string;
		teamName: string;
		wins: number;
		losses: number;
		ties: number;
		fpts: number;
		fptsAgainst: number;
		rosterId: number;
		playoffFinish: PlayoffFinish;
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

	function getPlayoffFinish(
		rosterId: number,
		winners: BracketMatch[]
	): PlayoffFinish {
		if (!winners?.length) return null;
		const appearsInWinners = winners.some(e => e.t1 === rosterId || e.t2 === rosterId);
		if (!appearsInWinners) return null;

		const maxR = Math.max(...winners.map(e => e.r));
		const lastRound = Math.max(
			...winners.filter(e => e.t1 === rosterId || e.t2 === rosterId).map(e => e.r)
		);

		if (lastRound < maxR) return 'playoffs';

		const finalMatch = winners.find(e => e.r === maxR && (e.t1 === rosterId || e.t2 === rosterId));
		if (!finalMatch) return 'playoffs';

		// Sleeper places both the championship and the 3rd-place game in the final round of
		// the winners bracket. The championship match has t1_from.w populated (the slot was
		// seeded by winning the semi); the 3rd-place match has t1_from.l (seeded by losing).
		const isChampionship = finalMatch.t1_from?.w != null;
		if (!isChampionship) return finalMatch.w === rosterId ? '3rd' : 'playoffs';
		return finalMatch.w === rosterId ? 'champion' : 'runner-up';
	}

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
				const [, profileRes] = await Promise.all([
					(async () => {
						let curId: string | null = leagueId;
						const result: SeasonStat[] = [];

						while (curId && curId !== '0') {
							const [leagueData, users, rosters, winnersData] = await Promise.all([
								fetchLeague(curId),
								fetchUsers(curId),
								fetchRosters(curId),
								fetchWinnersBracket(curId).catch(() => []),
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
									playoffFinish: getPlayoffFinish(roster.roster_id, winnersData),
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

	// ── Career stats ───────────────────────────────────────────────────────
	const careerWins   = $derived(seasons.reduce((s, x) => s + x.wins, 0));
	const careerLosses = $derived(seasons.reduce((s, x) => s + x.losses, 0));
	const careerTies   = $derived(seasons.reduce((s, x) => s + x.ties, 0));
	const careerFpts   = $derived(seasons.reduce((s, x) => s + x.fpts, 0));
	const careerGames  = $derived(careerWins + careerLosses + careerTies);
	const winPct       = $derived(careerGames > 0 ? ((careerWins + careerTies * 0.5) / careerGames * 100).toFixed(1) : '—');

	const championships      = $derived(seasons.filter(s => s.playoffFinish === 'champion').length);
	const playoffAppearances = $derived(seasons.filter(s => s.playoffFinish !== null).length);

	const bestSeason = $derived(
		seasons.length === 0 ? null :
		seasons.reduce((best, s) => {
			const games = s.wins + s.losses + s.ties;
			const sPct  = games > 0 ? (s.wins + s.ties * 0.5) / games : 0;
			const bGames = best.wins + best.losses + best.ties;
			const bPct  = bGames > 0 ? (best.wins + best.ties * 0.5) / bGames : 0;
			return sPct > bPct ? s : best;
		}, seasons[0])
	);

	const mostPointsSeason = $derived(
		seasons.length === 0 ? null :
		seasons.reduce((best, s) => s.fpts > best.fpts ? s : best, seasons[0])
	);

	// Only show Most Points card when it's a different season than Best Record.
	const distinctMostPointsSeason = $derived(
		mostPointsSeason === bestSeason ? null : mostPointsSeason
	);

	// ── Profile helpers ────────────────────────────────────────────────────
	const isOwnProfile = $derived(
		!!(data as any).user?.sleeperUserId && (data as any).user.sleeperUserId === data.userId
	);
	const isAdmin  = $derived(!!(data as any).isAdmin);
	const editHref = $derived(`/settings/profile?leagueId=${data.leagueId}`);

	const hasAnyProfile = $derived(
		!!(profile?.bio || profile?.location || profile?.favoriteNFLTeam ||
		   profile?.favoritePlayer || profile?.funFact || profile?.twitterHandle ||
		   leagueProfile?.joinedYear)
	);

	// ── Commissioner edit ──────────────────────────────────────────────────
	let commishEditing = $state(false);
	let commishSaving  = $state(false);
	let commishError   = $state('');
	let commishSuccess = $state(false);

	let ceFirstName       = $state('');
	let ceLastName        = $state('');
	let ceBio             = $state('');
	let ceLocation        = $state('');
	let ceFavoriteNFLTeam = $state('');
	let ceFavoritePlayer  = $state('');
	let ceFunFact         = $state('');
	let ceTwitterHandle   = $state('');
	let ceJoinedYear      = $state('');

	function openCommishEdit() {
		ceFirstName       = profile?.firstName ?? '';
		ceLastName        = profile?.lastName ?? '';
		ceBio             = profile?.bio ?? '';
		ceLocation        = profile?.location ?? '';
		ceFavoriteNFLTeam = profile?.favoriteNFLTeam ?? '';
		ceFavoritePlayer  = profile?.favoritePlayer ?? '';
		ceFunFact         = profile?.funFact ?? '';
		ceTwitterHandle   = profile?.twitterHandle ?? '';
		ceJoinedYear      = leagueProfile?.joinedYear?.toString() ?? '';
		commishError   = '';
		commishSuccess = false;
		commishEditing = true;
	}

	async function saveCommishEdit() {
		commishSaving = true;
		commishError  = '';
		commishSuccess = false;
		try {
			const res = await fetch(`/api/profile/${data.userId}?leagueId=${data.leagueId}`, {
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
			});
			if (!res.ok) {
				const d = await res.json().catch(() => ({}));
				throw new Error(d.message ?? `HTTP ${res.status}`);
			}
			const refreshed = await fetch(`/api/profile/${data.userId}?leagueId=${data.leagueId}`).then(r => r.json());
			profile        = refreshed?.global ?? null;
			leagueProfile  = refreshed?.league ?? null;
			commishSuccess = true;
			commishEditing = false;
			setTimeout(() => { commishSuccess = false; }, 3000);
		} catch (e: any) {
			commishError = e.message;
		} finally {
			commishSaving = false;
		}
	}

	// ── Finish label helpers ───────────────────────────────────────────────
	function finishLabel(f: PlayoffFinish): string {
		if (f === 'champion')   return '🏆 Champion';
		if (f === 'runner-up')  return '🥈 Runner-Up';
		if (f === '3rd')        return '🥉 3rd Place';
		if (f === 'playoffs')   return 'Playoffs';
		return '—';
	}

	function finishClass(f: PlayoffFinish): string {
		if (f === 'champion')  return 'text-amber-400 font-semibold';
		if (f === 'runner-up') return 'text-slate-300 font-medium';
		if (f === '3rd')       return 'text-amber-700 font-medium';
		if (f === 'playoffs')  return 'text-navy-500';
		return 'text-navy-700';
	}
</script>

<div>
	<!-- Back link -->
	<a href="/league/{data.leagueId}/managers" class="text-slate-500 hover:text-slate-300 text-sm mb-6 inline-flex items-center gap-1 transition-colors">
		← All Managers
	</a>

	{#if loading && !manager}
		<div class="space-y-3 mt-4">
			<div class="h-32 bg-navy-850 rounded-xl animate-pulse"></div>
			<div class="h-16 bg-navy-850 rounded-xl animate-pulse"></div>
			<div class="h-48 bg-navy-850 rounded-xl animate-pulse"></div>
			<p class="text-navy-500 text-sm">{loadingStatus}</p>
		</div>
	{:else if error}
		<p class="text-red-400 mt-4">Failed to load manager: {error}</p>
	{:else if manager}

		<!-- ── Header card ─────────────────────────────────────────────── -->
		<div class="mt-4 mb-4 p-5 bg-navy-850 rounded-xl border border-navy-700">
			<div class="flex items-start gap-4">
				<!-- Avatar -->
				<div class="shrink-0 relative">
					{#if manager.avatar}
						<img
							src={manager.avatar} alt=""
							class="w-20 h-20 rounded-full object-cover ring-2 {championships > 0 ? 'ring-amber-400/60' : 'ring-white/10'}"
						/>
					{:else}
						<div class="w-20 h-20 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-3xl ring-2 ring-white/10">
							🏈
						</div>
					{/if}
					{#if championships > 0}
						<span class="absolute -bottom-1 -right-1 bg-navy-900 rounded-full text-base leading-none p-0.5">🏆</span>
					{/if}
				</div>

				<!-- Name + record -->
				<div class="flex-1 min-w-0">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<h1 class="text-2xl font-bold text-white leading-tight truncate">{manager.teamName}</h1>
							{#if profile?.firstName || profile?.lastName}
								<p class="text-slate-300 text-sm font-medium">{[profile?.firstName, profile?.lastName].filter(Boolean).join(' ')}</p>
							{/if}
							<p class="text-slate-500 text-sm">{manager.displayName}</p>
						</div>
						<div class="flex items-center gap-2 shrink-0">
							{#if isOwnProfile}
								<a
									href={editHref}
									class="text-xs px-3 py-1.5 rounded-lg bg-navy-800 hover:bg-navy-700 text-slate-400 hover:text-white border border-navy-700 transition-colors"
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
						<div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-sm">
							<span class="text-slate-300 font-medium">
								{careerWins}–{careerLosses}{careerTies ? `–${careerTies}` : ''}
							</span>
							<span class="text-slate-500">{winPct}% win rate</span>
							<span class="text-slate-500">{careerFpts.toFixed(1)} pts scored</span>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- ── Career highlights strip ─────────────────────────────────── -->
		{#if seasons.length > 0}
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
				<div class="bg-navy-850 rounded-xl border border-navy-700 px-4 py-3 text-center">
					<p class="text-2xl font-black text-white tabular-nums">{seasons.length}</p>
					<p class="text-[10px] text-navy-500 uppercase tracking-widest mt-0.5">Seasons</p>
				</div>
				<div class="bg-navy-850 rounded-xl border {championships > 0 ? 'border-amber-500/30' : 'border-navy-700'} px-4 py-3 text-center">
					<p class="text-2xl font-black {championships > 0 ? 'text-amber-400' : 'text-navy-600'} tabular-nums">{championships}</p>
					<p class="text-[10px] text-navy-500 uppercase tracking-widest mt-0.5">Championship{championships !== 1 ? 's' : ''}</p>
				</div>
				<div class="bg-navy-850 rounded-xl border border-navy-700 px-4 py-3 text-center">
					<p class="text-2xl font-black text-white tabular-nums">{playoffAppearances}</p>
					<p class="text-[10px] text-navy-500 uppercase tracking-widest mt-0.5">Playoff Seasons</p>
				</div>
				<div class="bg-navy-850 rounded-xl border border-navy-700 px-4 py-3 text-center">
					<p class="text-2xl font-black text-white tabular-nums">{winPct}{#if careerGames > 0}<span class="text-base font-bold text-navy-500">%</span>{/if}</p>
					<p class="text-[10px] text-navy-500 uppercase tracking-widest mt-0.5">Win Rate</p>
				</div>
			</div>

			<!-- Best season / most points callouts -->
			{#if bestSeason || distinctMostPointsSeason}
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
					{#if bestSeason}
						{@const bGames = bestSeason.wins + bestSeason.losses + bestSeason.ties}
						{@const bPct = bGames > 0 ? ((bestSeason.wins + bestSeason.ties * 0.5) / bGames * 100).toFixed(1) : '—'}
						<div class="bg-navy-850 rounded-xl border border-navy-700 px-4 py-3 flex items-center justify-between gap-3">
							<div>
								<p class="text-[10px] text-navy-500 uppercase tracking-widest mb-0.5">Best Record</p>
								<p class="text-white font-bold">{bestSeason.wins}–{bestSeason.losses}{bestSeason.ties ? `–${bestSeason.ties}` : ''} <span class="text-slate-500 font-normal text-sm">({bPct}%)</span></p>
								<p class="text-slate-500 text-xs">{bestSeason.season} · {bestSeason.teamName}</p>
							</div>
							{#if bestSeason.playoffFinish === 'champion'}
								<span class="text-3xl shrink-0">🏆</span>
							{:else if bestSeason.playoffFinish === 'runner-up'}
								<span class="text-3xl shrink-0">🥈</span>
							{/if}
						</div>
					{/if}
					{#if distinctMostPointsSeason}
						<div class="bg-navy-850 rounded-xl border border-navy-700 px-4 py-3 flex items-center justify-between gap-3">
							<div>
								<p class="text-[10px] text-navy-500 uppercase tracking-widest mb-0.5">Most Points</p>
								<p class="text-white font-bold tabular-nums">{distinctMostPointsSeason.fpts.toFixed(1)} <span class="text-slate-500 font-normal text-sm">pts</span></p>
								<p class="text-slate-500 text-xs">{distinctMostPointsSeason.season} · {distinctMostPointsSeason.teamName}</p>
							</div>
							<span class="text-3xl shrink-0">📈</span>
						</div>
					{/if}
				</div>
			{/if}
		{/if}

		<!-- ── Commissioner edit form ───────────────────────────────────── -->
		{#if commishEditing}
			<div class="mb-4 p-5 bg-navy-850 rounded-xl border border-amber-500/30 space-y-4">
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
			<div class="mb-4 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-300 text-sm">
				Profile updated.
			</div>
		{/if}

		<!-- ── About card ───────────────────────────────────────────────── -->
		{#if hasAnyProfile}
			<div class="mb-4 p-5 bg-navy-850 rounded-xl border border-navy-700 space-y-3">
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
								class="text-amber-400 hover:text-amber-300 transition-colors"
							>@{profile.twitterHandle}</a>
						</div>
					{/if}
				</div>

				{#if profile?.funFact}
					<div class="pt-3 border-t border-navy-700">
						<p class="text-xs text-slate-600 uppercase tracking-wider mb-1">Fun Fact</p>
						<p class="text-slate-300 text-sm italic">"{profile.funFact}"</p>
					</div>
				{/if}
			</div>
		{:else if isOwnProfile && !loading}
			<div class="mb-4 p-4 bg-navy-850 rounded-xl border border-dashed border-navy-700 flex items-center justify-between gap-4">
				<p class="text-navy-500 text-sm">Your profile is empty. Add a bio and some info to stand out.</p>
				<a
					href={editHref}
					class="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold transition-colors"
				>
					Set up profile
				</a>
			</div>
		{/if}

		<!-- ── Season history table ─────────────────────────────────────── -->
		{#if seasons.length > 0}
			<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-3 flex items-center gap-2">
				<span class="text-amber-400">◆</span>Season History
			</h2>
			<div class="bg-navy-850 rounded-xl border border-navy-700 overflow-hidden">
				<table class="w-full text-sm">
					<thead>
						<tr class="border-b border-navy-700 text-navy-500 text-[10px] uppercase tracking-wider">
							<th class="px-4 py-3 text-left">Season</th>
							<th class="px-4 py-3 text-left hidden sm:table-cell">Team</th>
							<th class="px-4 py-3 text-right">W–L{careerTies ? '–T' : ''}</th>
							<th class="px-4 py-3 text-right">PF</th>
							<th class="px-4 py-3 text-right hidden sm:table-cell">PA</th>
							<th class="px-4 py-3 text-right">Finish</th>
						</tr>
					</thead>
					<tbody>
						{#each seasons as s}
							<tr class="border-b border-navy-700/50 hover:bg-navy-800 transition-colors">
								<td class="px-4 py-3 font-mono text-navy-500 tabular-nums">{s.season}</td>
								<td class="px-4 py-3 text-slate-400 truncate max-w-[140px] hidden sm:table-cell">{s.teamName}</td>
								<td class="px-4 py-3 text-right text-slate-300 tabular-nums">
									{s.wins}–{s.losses}{s.ties ? `–${s.ties}` : ''}
								</td>
								<td class="px-4 py-3 text-right text-slate-400 tabular-nums">{s.fpts.toFixed(1)}</td>
								<td class="px-4 py-3 text-right text-navy-500 tabular-nums hidden sm:table-cell">{s.fptsAgainst.toFixed(1)}</td>
								<td class="px-4 py-3 text-right tabular-nums whitespace-nowrap {finishClass(s.playoffFinish)}">
									{finishLabel(s.playoffFinish)}
								</td>
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
								<td class="px-4 py-3 text-right font-semibold text-slate-400 tabular-nums">{careerFpts.toFixed(1)}</td>
								<td class="px-4 py-3 hidden sm:table-cell"></td>
								<td class="px-4 py-3 text-right text-xs text-navy-500">
									{#if championships > 0}
										{championships}× 🏆
									{:else if playoffAppearances > 0}
										{playoffAppearances} playoff{playoffAppearances !== 1 ? 's' : ''}
									{/if}
								</td>
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
