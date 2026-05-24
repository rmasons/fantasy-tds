<script lang="ts">
	import { page } from '$app/state';
</script>

<div class="flex flex-col items-center justify-center py-24 text-center">
	<p class="text-5xl font-black text-navy-700 mb-4">{page.status}</p>
	<h1 class="text-xl font-bold text-white mb-2">
		{page.status === 404 ? 'Page not found' : 'Something went wrong'}
	</h1>
	<p class="text-slate-400 text-sm mb-6">
		{page.error?.message ?? 'An unexpected error occurred.'}
	</p>
	<a
		href="/league/{page.params.leagueId}"
		class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-navy-800 hover:bg-navy-700
		       border border-navy-700 text-sm text-slate-300 hover:text-white transition-colors"
	>
		Back to league home
	</a>
</div>
