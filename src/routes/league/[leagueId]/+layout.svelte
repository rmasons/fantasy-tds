<script lang="ts">
	import LeagueNav from '$lib/components/LeagueNav.svelte';
	import type { LayoutData } from './$types';

	let { data, children } = $props<{ data: LayoutData; children: any }>();
</script>

<div class="min-h-screen bg-gray-950 text-white">
	<LeagueNav leagueId={data.leagueId} />
	<main class="max-w-7xl mx-auto px-4 py-6">
		{@render children()}
	</main>
</div>
