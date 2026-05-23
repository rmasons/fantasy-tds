<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Global field state — seeded from saved values
	let displayName = $state(data.globalProfile?.displayName ?? '');
	let firstName = $state(data.globalProfile?.firstName ?? '');
	let lastName = $state(data.globalProfile?.lastName ?? '');
	let bio = $state(data.globalProfile?.bio ?? '');
	let location = $state(data.globalProfile?.location ?? '');
	let favoriteNFLTeam = $state(data.globalProfile?.favoriteNFLTeam ?? '');
	let favoritePlayer = $state(data.globalProfile?.favoritePlayer ?? '');
	let funFact = $state(data.globalProfile?.funFact ?? '');
	let twitterHandle = $state(data.globalProfile?.twitterHandle ?? '');

	// League field state
	let joinedYear = $state(data.leagueProfile?.joinedYear?.toString() ?? '');

	let savingGlobal = $state(false);
	let savingLeague = $state(false);

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
					{form.section === 'league' ? 'League info' : 'Profile'} saved.
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
					return async ({ update }) => {
						await update();
						savingGlobal = false;
					};
				}}
			>
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

					<!-- Location -->
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

					<!-- Favorite NFL Team + Player side by side -->
					<div class="grid sm:grid-cols-2 gap-4">
						<div>
							<label for="favoriteNFLTeam" class="block text-sm font-medium text-slate-300 mb-1.5">
								Favorite NFL Team
							</label>
							<input
								id="favoriteNFLTeam"
								name="favoriteNFLTeam"
								type="text"
								maxlength="60"
								bind:value={favoriteNFLTeam}
								placeholder="e.g. Kansas City Chiefs"
								class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
							/>
						</div>
						<div>
							<label for="favoritePlayer" class="block text-sm font-medium text-slate-300 mb-1.5">
								Favorite Player
							</label>
							<input
								id="favoritePlayer"
								name="favoritePlayer"
								type="text"
								maxlength="60"
								bind:value={favoritePlayer}
								placeholder="e.g. Justin Jefferson"
								class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
							/>
						</div>
					</div>

					<!-- Fun Fact -->
					<div>
						<label for="funFact" class="block text-sm font-medium text-slate-300 mb-1.5">
							Fun Fact / Trash Talk
						</label>
						<input
							id="funFact"
							name="funFact"
							type="text"
							maxlength="200"
							bind:value={funFact}
							placeholder="One thing your league needs to know..."
							class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
						/>
						<p class="text-xs text-slate-600 mt-1 text-right">{funFact.length}/200</p>
					</div>

					<!-- Twitter -->
					<div>
						<label for="twitterHandle" class="block text-sm font-medium text-slate-300 mb-1.5">
							X / Twitter Handle
						</label>
						<div class="flex items-center">
							<span class="bg-slate-700 border border-r-0 border-slate-700 rounded-l-lg px-3 py-2.5 text-slate-400 text-sm select-none">@</span>
							<input
								id="twitterHandle"
								name="twitterHandle"
								type="text"
								maxlength="50"
								bind:value={twitterHandle}
								placeholder="yourhandle"
								class="flex-1 bg-slate-800 border border-slate-700 rounded-r-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
							/>
						</div>
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

			<!-- ── League-specific section ── -->
			{#if data.leagueId}
				<form
					method="post"
					action="?/saveLeague&leagueId={data.leagueId}"
					class="mt-6"
					use:enhance={() => {
						savingLeague = true;
						return async ({ update }) => {
							await update();
							savingLeague = false;
						};
					}}
				>
					<section class="bg-slate-900 rounded-xl border border-slate-800 p-6 space-y-5">
						<h2 class="text-base font-semibold text-slate-200">League Info</h2>
						<p class="text-xs text-slate-500 -mt-2">Specific to this league — you can set different info per league.</p>

						<!-- Joined Year -->
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
								class="w-36 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-amber-500"
							/>
						</div>

						<div class="pt-1">
							<button
								type="submit"
								disabled={savingLeague}
								class="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-semibold transition-colors"
							>
								{savingLeague ? 'Saving…' : 'Save League Info'}
							</button>
						</div>
					</section>
				</form>
			{/if}

		{/if}
	</div>
</div>
