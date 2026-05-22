<script lang="ts">
	import type { PageData } from './$types';
	import type { SleeperLeague } from '$lib/types';
	import { goto } from '$app/navigation';

	let { data } = $props<{ data: PageData }>();

	// Sleeper account linking
	let sleeperUsername = $state('');
	let linkStatus = $state<'idle' | 'loading' | 'error'>('idle');
	let linkError = $state('');

	// League selection
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
		// Reload the page so the server re-reads the updated profile
		window.location.reload();
	}

	async function loadLeagues() {
		if (!data.user?.sleeperUserId) return;
		leaguesLoading = true;
		const season = new Date().getFullYear();
		const res = await fetch(
			`https://api.sleeper.app/v1/user/${data.user.sleeperUserId}/leagues/nfl/${season}`
		);
		leagues = await res.json();
		leaguesLoading = false;

		if (leagues.length === 1) {
			selectLeague(leagues[0].league_id);
		}
	}

	function selectLeague(leagueId: string) {
		goto(`/league/${leagueId}`);
	}

	// Auto-load leagues once Sleeper is linked
	$effect(() => {
		if (data.user?.sleeperUserId) {
			loadLeagues();
		}
	});
</script>

<div class="min-h-screen bg-gray-950 text-white flex items-center justify-center p-4">
	<div class="w-full max-w-lg">

		{#if !data.user?.sleeperUserId}
			<!-- Step 1: Link Sleeper account -->
			<div class="bg-gray-900 rounded-2xl p-8 shadow-xl">
				<h1 class="text-2xl font-bold mb-1">Link your Sleeper account</h1>
				<p class="text-gray-400 text-sm mb-6">
					Enter your Sleeper username to connect your leagues.
				</p>

				<form onsubmit={(e) => { e.preventDefault(); linkSleeper(); }}>
					<label for="username" class="block text-sm text-gray-400 mb-1">Sleeper username</label>
					<input
						id="username"
						type="text"
						bind:value={sleeperUsername}
						placeholder="your_sleeper_username"
						required
						class="w-full px-4 py-2 rounded-lg bg-gray-800 text-white border border-gray-700
						       focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
					/>
					{#if linkError}
						<p class="text-red-400 text-sm mb-3">{linkError}</p>
					{/if}
					<button
						type="submit"
						disabled={linkStatus === 'loading'}
						class="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50
						       text-white font-semibold transition-colors"
					>
						{linkStatus === 'loading' ? 'Looking up…' : 'Connect Sleeper'}
					</button>
				</form>
			</div>

		{:else if leaguesLoading}
			<!-- Loading leagues -->
			<div class="text-center">
				<p class="text-gray-400">Loading your leagues…</p>
			</div>

		{:else if leagues.length === 0}
			<!-- No leagues found -->
			<div class="bg-gray-900 rounded-2xl p-8 shadow-xl text-center">
				<p class="text-gray-300">No NFL leagues found for <strong>{data.user.sleeperUsername}</strong> this season.</p>
			</div>

		{:else}
			<!-- League picker (only shown when user has more than 1 league; single-league auto-redirects) -->
			<div class="bg-gray-900 rounded-2xl p-8 shadow-xl">
				<h1 class="text-2xl font-bold mb-1">Select a league</h1>
				<p class="text-gray-400 text-sm mb-6">
					Welcome back, <strong class="text-white">{data.user.sleeperUsername}</strong>.
				</p>

				<ul class="space-y-3">
					{#each leagues as league}
						<li>
							<button
								onclick={() => selectLeague(league.league_id)}
								class="w-full flex items-center gap-4 p-4 rounded-xl bg-gray-800
								       hover:bg-gray-700 transition-colors text-left"
							>
								{#if league.avatar}
									<img
										src="https://sleepercdn.com/avatars/thumbs/{league.avatar}"
										alt=""
										class="w-12 h-12 rounded-full object-cover flex-shrink-0"
									/>
								{:else}
									<div class="w-12 h-12 rounded-full bg-gray-600 flex items-center justify-center flex-shrink-0">
										🏈
									</div>
								{/if}
								<div>
									<p class="font-semibold text-white">{league.name}</p>
									<p class="text-sm text-gray-400">
										{league.season} · {league.total_rosters} teams ·
										{league.settings.type === 2 ? 'Dynasty' : 'Redraft'}
									</p>
								</div>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

	</div>
</div>
