<script lang="ts">
	import LeagueNav from '$lib/components/LeagueNav.svelte';
	import type { LayoutData } from './$types';

	let { data, children } = $props<{ data: LayoutData; children: any }>();
</script>

<div class="min-h-screen bg-navy-950 text-white">
	<LeagueNav leagueId={data.leagueId} />
	<!-- lg: offset for fixed sidebar; mobile: offset for sticky top nav -->
	<div class="lg:pl-56 pt-14 lg:pt-0">
		<main class="max-w-6xl mx-auto px-4 sm:px-6 py-6 lg:py-8">
			{@render children()}
		</main>
	</div>
</div>
