<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div class="max-w-xl space-y-8">
	<div>
		<nav class="text-xs text-slate-500 mb-4">
			<a href="/admin" class="hover:text-slate-300">Dashboard</a>
			<span class="mx-1.5">›</span>
			<span class="text-slate-300">App Config</span>
		</nav>
		<h1 class="text-2xl font-extrabold text-white">App Config</h1>
		<p class="text-slate-500 text-sm mt-1">Global settings applied across all leagues.</p>
	</div>

	<form method="POST" use:enhance class="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
		<div>
			<label for="defaultLeagueId" class="block text-sm font-medium text-slate-300 mb-1.5">
				Default League ID
			</label>
			<input
				id="defaultLeagueId"
				name="defaultLeagueId"
				type="text"
				value={data.appConfig.defaultLeagueId ?? ''}
				placeholder="Sleeper league ID"
				class="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
			/>
			<p class="text-xs text-slate-600 mt-1.5">
				Guests (not signed in) who visit / are redirected here automatically.
			</p>
		</div>

		<div class="flex items-center gap-4">
			<button
				type="submit"
				class="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium text-white transition-colors"
			>
				Save
			</button>
			{#if form?.success}
				<span class="text-xs text-emerald-400">Saved.</span>
			{/if}
		</div>
	</form>
</div>
