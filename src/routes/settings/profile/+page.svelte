<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { PageData, ActionData } from './$types';
	import { NFL_TEAMS, teamAbbrByName, teamLogoUrl, playerThumbUrl } from '$lib/nflTeams';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Global field state — seeded from saved values
	let displayName    = $state(data.globalProfile?.displayName ?? '');
	let firstName      = $state(data.globalProfile?.firstName ?? '');
	let lastName       = $state(data.globalProfile?.lastName ?? '');
	let bio            = $state(data.globalProfile?.bio ?? '');
	let location       = $state(data.globalProfile?.location ?? '');
	let preferredContact = $state(data.globalProfile?.preferredContact ?? '');

	// League field state — per-league, submitted with global form when leagueId is set
	let joinedYear = $state(data.leagueProfile?.joinedYear?.toString() ?? '');

	// ── Team autocomplete ────────────────────────────────────────────────────────
	let teamQuery   = $state(data.globalProfile?.favoriteNFLTeam ?? '');
	let teamResults = $state<typeof NFL_TEAMS>([]);
	let teamOpen    = $state(false);

	const teamAbbr = $derived(teamAbbrByName(teamQuery));

	function onTeamInput() {
		const q = teamQuery.toLowerCase().trim();
		if (q.length < 1) { teamResults = []; teamOpen = false; return; }
		teamResults = NFL_TEAMS.filter(t => t.name.toLowerCase().includes(q));
		teamOpen = teamResults.length > 0;
	}

	function selectTeam(team: typeof NFL_TEAMS[0]) {
		teamQuery = team.name;
		teamResults = [];
		teamOpen = false;
	}

	function onTeamBlur() {
		setTimeout(() => { teamOpen = false; }, 150);
	}

	// ── Player autocomplete ──────────────────────────────────────────────────────
	type PlayerResult = { id: string; name: string; pos: string; team: string };

	let playerQuery    = $state(data.globalProfile?.favoritePlayer ?? '');
	let favoritePlayerId = $state(data.globalProfile?.favoritePlayerId ?? '');
	let playerResults  = $state<PlayerResult[]>([]);
	let playerOpen     = $state(false);
	let playerTimer: ReturnType<typeof setTimeout> | null = null;

	function onPlayerInput() {
		favoritePlayerId = '';
		if (playerTimer) clearTimeout(playerTimer);
		const q = playerQuery.trim();
		if (q.length < 2) { playerResults = []; playerOpen = false; return; }
		playerTimer = setTimeout(async () => {
			const res = await fetch(`/api/players/search?q=${encodeURIComponent(q)}`);
			if (res.ok) {
				playerResults = await res.json();
				playerOpen = playerResults.length > 0;
			}
		}, 200);
	}

	function selectPlayer(p: PlayerResult) {
		playerQuery      = p.name;
		favoritePlayerId = p.id;
		playerResults    = [];
		playerOpen       = false;
	}

	function onPlayerBlur() {
		setTimeout(() => { playerOpen = false; }, 150);
	}

	// ────────────────────────────────────────────────────────────────────────────
	let savingGlobal = $state(false);

	const backHref = data.leagueId
		? `/league/${data.leagueId}/managers/${data.user.sleeperUserId}`
		: '/';

	const noSleeperLinked = !data.user.sleeperUserId;
</script>

<div class="min-h-screen bg-slate-950 text-white">
	<div class="max-w-2xl mx-auto px-4 py-8">

		<!-- Header -->
		<div class="mb-8">
			<a
				href={backHref}
				class="text-slate-500 hover:text-slate-300 text-sm inline-flex items-center gap-1 transition-colors mb-4"
			>
				← Back
			</a>
			<h1 class="text-2xl font-bold">My Profile</h1>
			<p class="text-slate-400 text-sm mt-1">
				This info appears on your manager card and profile page.
			</p>
		</div>

		{#if noSleeperLinked}
			<div class="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-amber-300 text-sm">
				You need to link your Sleeper account before editing your profile.
				<a href="/" class="underline ml-1">Link Sleeper account</a>
			</div>
		{:else}

			<!-- Success banner -->
			{#if form?.success}
				<div class="mb-6 bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-300 text-sm">
					Profile saved.
				</div>
			{/if}

			<!-- Error banner -->
			{#if form?.error}
				<div class="mb-6 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-300 text-sm">
					{form.error}
				</div>
			{/if}

			<!-- ── Global profile form ── -->
			<form
				method="post"
				action="?/saveGlobal{data.leagueId ? `&leagueId=${data.leagueId}` : ''}"
				use:enhance={() => {
					savingGlobal = true;
					return async ({ result, update }) => {
						if (result.type === 'success') {
							goto(backHref);
						} else {
							await update();
							savingGlobal = false;
						}
					};
				}}
			>
				<!-- Hidden fields for structured values -->
				<input type="hidden" name="favoritePlayerId" value={favoritePlayerId} />

				<section class="bg-slate-900 rounded-xl border border-slate-800 p-6 space-y-5">
					<h2 class="text-base font-semibold text-slate-200">About Me</h2>

					<!-- Display Name -->
					<div>
						<label for="displayName" class="block text-sm font-medium text-slate-300 mb-1.5">
							Preferred Display Name
						</label>
						<input
							id="displayName"
							name="displayName"
							type="text"
							maxlength="50"
							bind:value={displayName}
							placeholder="How you want to appear across the app"
							class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
						/>
						<p class="text-xs text-slate-600 mt-1">
							Overrides your Sleeper username everywhere names appear. Leave blank to use your Sleeper username.
						</p>
					</div>

					<!-- Name -->
					<div class="grid sm:grid-cols-2 gap-4">
						<div>
							<label for="firstName" class="block text-sm font-medium text-slate-300 mb-1.5">First Name</label>
							<input
								id="firstName"
								name="firstName"
								type="text"
								maxlength="50"
								bind:value={firstName}
								placeholder="First"
								class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
							/>
						</div>
						<div>
							<label for="lastName" class="block text-sm font-medium text-slate-300 mb-1.5">Last Name</label>
							<input
								id="lastName"
								name="lastName"
								type="text"
								maxlength="50"
								bind:value={lastName}
								placeholder="Last"
								class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
							/>
						</div>
					</div>

					<!-- Bio -->
					<div>
						<label for="bio" class="block text-sm font-medium text-slate-300 mb-1.5">
							Bio
						</label>
						<textarea
							id="bio"
							name="bio"
							rows="3"
							maxlength="280"
							bind:value={bio}
							placeholder="Tell your league who you are..."
							class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500 resize-none"
						></textarea>
						<p class="text-xs text-slate-600 mt-1 text-right">{bio.length}/280</p>
					</div>

					<!-- Location + Year Joined (inline when in league context) -->
					<div class="grid gap-4" class:sm:grid-cols-2={data.leagueId}>
						<div>
							<label for="location" class="block text-sm font-medium text-slate-300 mb-1.5">
								Location
							</label>
							<input
								id="location"
								name="location"
								type="text"
								maxlength="60"
								bind:value={location}
								placeholder="City, State"
								class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
							/>
						</div>
						{#if data.leagueId}
							<div>
								<label for="joinedYear" class="block text-sm font-medium text-slate-300 mb-1.5">
									Year Joined League
								</label>
								<input
									id="joinedYear"
									name="joinedYear"
									type="number"
									min="1990"
									max="2100"
									bind:value={joinedYear}
									placeholder="e.g. 2018"
									class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
								/>
							</div>
						{/if}
					</div>

					<!-- Favorite Team + Favorite Player (autocomplete) -->
					<div class="grid sm:grid-cols-2 gap-4">

						<!-- Team autocomplete -->
						<div>
							<label for="favoriteNFLTeam" class="block text-sm font-medium text-slate-300 mb-1.5">
								Favorite NFL Team
							</label>
							<div class="relative">
								<div class="relative">
									{#if teamAbbr}
										<img
											src={teamLogoUrl(teamAbbr)}
											alt=""
											class="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 object-contain pointer-events-none"
										/>
									{/if}
									<input
										id="favoriteNFLTeam"
										name="favoriteNFLTeam"
										type="text"
										maxlength="60"
										autocomplete="off"
										bind:value={teamQuery}
										oninput={onTeamInput}
										onfocusout={onTeamBlur}
										placeholder="e.g. Kansas City Chiefs"
										class="w-full bg-slate-800 border border-slate-700 rounded-lg py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500 {teamAbbr ? 'pl-10 pr-3' : 'px-3'}"
									/>
								</div>
								{#if teamOpen}
									<div class="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl overflow-hidden max-h-56 overflow-y-auto">
										{#each teamResults as team}
											<button
												type="button"
												class="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-700 transition-colors text-left"
												onmousedown={(e) => { e.preventDefault(); selectTeam(team); }}
											>
												<img src={teamLogoUrl(team.abbr)} alt="" class="w-5 h-5 object-contain shrink-0" />
												<span class="text-sm text-white">{team.name}</span>
											</button>
										{/each}
									</div>
								{/if}
							</div>
						</div>

						<!-- Player autocomplete -->
						<div>
							<label for="favoritePlayer" class="block text-sm font-medium text-slate-300 mb-1.5">
								Favorite Player
							</label>
							<div class="relative">
								<div class="relative">
									{#if favoritePlayerId}
										<img
											src={playerThumbUrl(favoritePlayerId)}
											alt=""
											class="absolute left-1.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full object-cover object-top bg-slate-700 pointer-events-none"
										/>
									{/if}
									<input
										id="favoritePlayer"
										name="favoritePlayer"
										type="text"
										maxlength="60"
										autocomplete="off"
										bind:value={playerQuery}
										oninput={onPlayerInput}
										onfocusout={onPlayerBlur}
										placeholder="e.g. Justin Jefferson"
										class="w-full bg-slate-800 border border-slate-700 rounded-lg py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500 {favoritePlayerId ? 'pl-10 pr-3' : 'px-3'}"
									/>
								</div>
								{#if playerOpen}
									<div class="absolute z-20 w-full mt-1 bg-slate-800 border border-slate-700 rounded-lg shadow-2xl overflow-hidden max-h-64 overflow-y-auto">
										{#each playerResults as player}
											<button
												type="button"
												class="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-700 transition-colors text-left"
												onmousedown={(e) => { e.preventDefault(); selectPlayer(player); }}
											>
												<img
													src={playerThumbUrl(player.id)}
													alt=""
													class="w-8 h-8 rounded-full object-cover object-top bg-slate-700 shrink-0"
												/>
												<div class="min-w-0">
													<p class="text-sm text-white leading-tight truncate">{player.name}</p>
													<p class="text-xs text-slate-500 leading-tight">{player.pos} · {player.team}</p>
												</div>
											</button>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					</div>

					<!-- Preferred Trade Contact -->
					<div>
						<label for="preferredContact" class="block text-sm font-medium text-slate-300 mb-1.5">
							Preferred Trade Contact
						</label>
						<select
							id="preferredContact"
							name="preferredContact"
							bind:value={preferredContact}
							class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 appearance-none"
						>
							<option value="">— Select —</option>
							<option value="iMessage">iMessage</option>
							<option value="Phone Call">Phone Call</option>
							<option value="Signal">Signal</option>
							<option value="Instagram DM">Instagram DM</option>
							<option value="Snapchat">Snapchat</option>
							<option value="Discord">Discord</option>
							<option value="Email">Email</option>
							<option value="Smoke Signal">Smoke Signal</option>
							<option value="Don't contact me">Don't contact me</option>
						</select>
					</div>

					<div class="pt-1">
						<button
							type="submit"
							disabled={savingGlobal}
							class="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-colors"
						>
							{savingGlobal ? 'Saving…' : 'Save Profile'}
						</button>
					</div>
				</section>
			</form>

		{/if}
	</div>
</div>
