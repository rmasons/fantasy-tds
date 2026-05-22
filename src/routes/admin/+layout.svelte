<script lang="ts">
	import { page } from '$app/state';

	let { children } = $props();

	function isActive(path: string) {
		return page.url.pathname === path || page.url.pathname.startsWith(path + '/');
	}
</script>

<div class="min-h-screen bg-slate-950 text-white">
	<header class="bg-slate-900 border-b border-slate-800 sticky top-0 z-40">
		<div class="max-w-5xl mx-auto px-6 h-14 flex items-center gap-6">
			<span class="font-bold text-white text-sm tracking-wide">Admin Panel</span>
			<nav class="flex items-center gap-1">
				<a
					href="/admin"
					class="px-3 py-1.5 rounded-lg text-sm transition-colors
					       {page.url.pathname === '/admin'
					           ? 'bg-slate-800 text-white font-medium'
					           : 'text-slate-400 hover:text-white hover:bg-slate-800/60'}"
				>Dashboard</a>
				<a
					href="/admin/app"
					class="px-3 py-1.5 rounded-lg text-sm transition-colors
					       {isActive('/admin/app')
					           ? 'bg-slate-800 text-white font-medium'
					           : 'text-slate-400 hover:text-white hover:bg-slate-800/60'}"
				>App Config</a>
			</nav>
			<div class="ml-auto">
				<a href="/" class="text-xs text-slate-500 hover:text-slate-300 transition-colors">
					← Back to app
				</a>
			</div>
		</div>
	</header>

	<main class="max-w-5xl mx-auto px-6 py-10">
		{@render children()}
	</main>
</div>
