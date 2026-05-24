<script lang="ts">
	import { page } from '$app/state';

	const is404 = page.status === 404;
</script>

{#if is404}
	<div class="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
		<div class="absolute inset-0 bg-gradient-to-br from-amber-600/4 via-transparent to-orange-600/3 pointer-events-none"></div>

		<div class="relative w-full max-w-sm">
			<!-- Trade card -->
			<div class="bg-slate-900 rounded-2xl border border-white/[0.07] overflow-hidden">
				<!-- Header bar -->
				<div class="bg-amber-500/10 border-b border-amber-500/20 px-5 py-3 flex items-center gap-2">
					<span class="w-2 h-2 rounded-full bg-amber-400"></span>
					<p class="text-xs font-bold uppercase tracking-widest text-amber-400">Trade Accepted</p>
				</div>

				<div class="px-6 py-7">
					<!-- Teams -->
					<div class="flex items-center gap-3 mb-6">
						<!-- You gave -->
						<div class="flex-1 text-center">
							<p class="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">You gave</p>
							<div class="bg-slate-800 rounded-xl p-3 border border-white/[0.07]">
								<p class="text-2xl mb-1">📄</p>
								<p class="text-xs font-bold text-white leading-tight">This Page</p>
								<p class="text-[10px] text-slate-500 mt-0.5">404 pts/wk</p>
							</div>
						</div>

						<div class="shrink-0 flex flex-col items-center gap-1">
							<div class="w-7 h-px bg-slate-700"></div>
							<p class="text-slate-600 text-xs font-mono">FOR</p>
							<div class="w-7 h-px bg-slate-700"></div>
						</div>

						<!-- You got -->
						<div class="flex-1 text-center">
							<p class="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">You got</p>
							<div class="bg-slate-800 rounded-xl p-3 border border-white/[0.07]">
								<p class="text-2xl mb-1">🗑️</p>
								<p class="text-xs font-bold text-white leading-tight">2027 6th Rd Pick</p>
								<p class="text-[10px] text-slate-500 mt-0.5">projected: 0.0</p>
							</div>
						</div>
					</div>

					<!-- Commish stamp -->
					<div class="flex items-center gap-2 mb-7">
						<div class="flex-1 h-px bg-white/[0.05]"></div>
						<p class="text-[10px] text-slate-600 shrink-0">Commish approved · League vetoed 0–0</p>
						<div class="flex-1 h-px bg-white/[0.05]"></div>
					</div>

					<!-- CTA -->
					<a
						href="/"
						class="block w-full text-center py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400
						       text-slate-950 font-bold text-sm transition-colors"
					>
						File a trade dispute
					</a>
					<p class="text-center text-[11px] text-slate-600 mt-2">
						(this just goes home, disputes aren't real)
					</p>
				</div>
			</div>
		</div>
	</div>

{:else}
	<div class="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
		<div class="text-center max-w-sm">
			<p class="text-5xl font-black text-slate-700 mb-4">{page.status}</p>
			<h1 class="text-xl font-bold text-white mb-2">Something went wrong</h1>
			<p class="text-slate-400 text-sm mb-6">
				{page.error?.message ?? 'An unexpected error occurred.'}
			</p>
			<a
				href="/"
				class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700
				       text-sm text-slate-300 hover:text-white transition-colors"
			>
				Go home
			</a>
		</div>
	</div>
{/if}
