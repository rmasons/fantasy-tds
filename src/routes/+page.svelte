<script lang="ts">
	import type { PageData } from './$types';
	import type { SleeperLeague } from '$lib/types';
	import { goto } from '$app/navigation';

	let { data } = $props<{ data: PageData }>();

	let sleeperUsername = $state('');
	let linkStatus = $state<'idle' | 'loading' | 'error'>('idle');
	let linkError = $state('');

	let leagues = $state<SleeperLeague[]>([]);
	let leaguesLoading = $state(false);

	async function linkSleeper() {
		linkStatus = 'loading';
		linkError = '';
		const res = await fetch('/api/auth/sleeper', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: sleeperUsername })
		});
		if (!res.ok) {
			const { error } = await res.json();
			linkError = error;
			linkStatus = 'error';
			return;
		}
		window.location.reload();
	}

	let cachedNflSeason: string | null = null;
	async function getNflSeason(): Promise<string> {
		if (cachedNflSeason) return cachedNflSeason;
		try {
			const res = await fetch('https://api.sleeper.app/v1/state/nfl');
			const state = res.ok ? await res.json() : null;
			cachedNflSeason = state?.season ?? String(new Date().getFullYear());
		} catch {
			cachedNflSeason = String(new Date().getFullYear());
		}
		return cachedNflSeason;
	}

	async function loadLeagues() {
		if (!data.user?.sleeperUserId) return;
		leaguesLoading = true;
		const season = await getNflSeason();
		const res = await fetch(
			`https://api.sleeper.app/v1/user/${data.user.sleeperUserId}/leagues/nfl/${season}`
		);
		if (!res.ok) {
			leaguesLoading = false;
			return;
		}
		leagues = await res.json();
		leaguesLoading = false;

		if (leagues.length === 1) {
			selectLeague(leagues[0].league_id);
		}
	}

	function selectLeague(leagueId: string) {
		goto(`/league/${leagueId}`);
	}

	$effect(() => {
		if (data.user?.sleeperUserId) {
			loadLeagues();
		}
	});
</script>

<div class="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
	<!-- Background gradient -->
	<div class="absolute inset-0 bg-gradient-to-br from-blue-600/5 via-transparent to-violet-600/5 pointer-events-none"></div>

	<div class="relative w-full max-w-lg">

		{#if !data.user?.sleeperUserId}
			<!-- Link Sleeper account -->
			<div class="bg-slate-900 rounded-2xl p-8 shadow-2xl border border-slate-800/60">
				<div class="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent rounded-full"></div>

				<div class="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center text-xl mb-5 shadow-lg shadow-blue-900/30">
					🏈
				</div>

				<h1 class="text-2xl font-extrabold mb-1">Link your Sleeper account</h1>
				<p class="text-slate-400 text-sm mb-6">
					Enter your Sleeper username to connect your leagues.
				</p>

				<form onsubmit={(e) => { e.preventDefault(); linkSleeper(); }}>
					<label for="username" class="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-1.5">
						Sleeper username
					</label>
					<input
						id="username"
						type="text"
						bind:value={sleeperUsername}
						placeholder="your_sleeper_username"
						required
						class="w-full px-4 py-2.5 rounded-xl bg-slate-800 text-white border border-slate-700
						       focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
						       placeholder:text-slate-600 mb-4 transition-colors"
					/>
					{#if linkError}
						<p class="text-red-400 text-sm mb-3">{linkError}</p>
					{/if}
					<button
						type="submit"
						disabled={linkStatus === 'loading'}
						class="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500
						       hover:from-blue-500 hover:to-blue-400 disabled:opacity-50
						       text-white font-semibold transition-all shadow-md shadow-blue-900/30"
					>
						{linkStatus === 'loading' ? 'Looking up…' : 'Connect Sleeper'}
					</button>
				</form>
			</div>

		{:else if leaguesLoading}
			<div class="text-center">
				<div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
				<p class="text-slate-400 text-sm">Loading your leagues…</p>
			</div>

		{:else if leagues.length === 0}
			<div class="bg-slate-900 rounded-2xl p-8 shadow-xl border border-slate-800/60 text-center">
				<p class="text-slate-300">No NFL leagues found for <strong class="text-white">{data.user.sleeperUsername}</strong> this season.</p>
			</div>

		{:else}
			<!-- League picker -->
			<div class="bg-slate-900 rounded-2xl p-6 shadow-2xl border border-slate-800/60">
				<h1 class="text-xl font-extrabold mb-0.5">Select a league</h1>
				<p class="text-slate-400 text-sm mb-5">
					Welcome back, <strong class="text-white">{data.user.sleeperUsername}</strong>.
				</p>

				<ul class="space-y-2">
					{#each leagues as league}
						<li>
							<button
								onclick={() => selectLeague(league.league_id)}
								class="w-full flex items-center gap-4 p-4 rounded-xl bg-slate-800
								       hover:bg-slate-700 border border-slate-700/50 hover:border-slate-600
								       transition-all text-left group"
							>
								{#if league.avatar}
									<img
										src="https://sleepercdn.com/avatars/thumbs/{league.avatar}"
										alt=""
										class="w-11 h-11 rounded-full object-cover flex-shrink-0 ring-2 ring-slate-600 group-hover:ring-blue-500 transition-all"
									/>
								{:else}
									<div class="w-11 h-11 rounded-full bg-gradient-to-br from-blue-600 to-violet-600 flex items-center justify-center flex-shrink-0 text-lg">
										🏈
									</div>
								{/if}
								<div>
									<p class="font-semibold text-white group-hover:text-blue-300 transition-colors">{league.name}</p>
									<p class="text-sm text-slate-500">
										{league.season} · {league.total_rosters} teams ·
										{league.settings.type === 2 ? 'Dynasty' : 'Redraft'}
									</p>
								</div>
								<svg class="w-4 h-4 text-slate-600 group-hover:text-slate-400 ml-auto shrink-0 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
								</svg>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

	</div>
</div>
