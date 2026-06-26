<script lang="ts">
	import type { PageData } from './$types';

	let { data } = $props<{ data: PageData }>();

	const fmtFaab = (amount: number) => (amount >= 0 ? '+$' : '-$') + Math.abs(amount);
	const fmtNet = (amount: number) => (amount >= 0 ? '+$' : '-$') + Math.abs(amount);
	const fmtDate = (ts: number) =>
		ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
</script>

<div>
	<div class="mb-6">
		<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">FAAB Ledger</h1>
		<p class="text-navy-500 text-[10px] uppercase tracking-[0.2em] font-semibold mt-1">
			Commissioner FAAB grants &amp; penalties
		</p>
	</div>

	<!-- Net by team -->
	{#if data.totals.length > 0}
		<section class="bg-navy-850 rounded-lg border border-navy-700 p-6 mb-6">
			<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-4">Net Adjustments by Team</h2>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
				{#each data.totals as t}
					<div class="flex items-center gap-3 py-1.5 border-t border-navy-700/40 first:border-0 sm:[&:nth-child(2)]:border-0">
						{#if t.avatar}
							<img src={t.avatar} alt="" class="w-7 h-7 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
						{:else}
							<div class="w-7 h-7 rounded-full bg-navy-800 shrink-0 flex items-center justify-center text-sm">🏈</div>
						{/if}
						<span class="flex-1 text-sm text-slate-300 truncate">{t.teamName}</span>
						<span class="font-mono font-bold text-sm {t.net >= 0 ? 'text-green-400' : 'text-red-400'}">{fmtNet(t.net)}</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Transaction ledger -->
	<section class="bg-navy-850 rounded-lg border border-navy-700 p-6">
		<h2 class="font-sport font-bold text-xs uppercase tracking-widest text-slate-300 mb-4">Transactions</h2>
		{#if data.ledger.length === 0}
			<p class="text-sm text-navy-500">No FAAB adjustments have been made.</p>
		{:else}
			<div class="space-y-1">
				{#each data.ledger as txn (txn.id)}
					<div class="flex items-center gap-3 py-2.5 border-t border-navy-700/40 first:border-0">
						{#if txn.avatar}
							<img src={txn.avatar} alt="" class="w-8 h-8 rounded-full object-cover shrink-0 ring-1 ring-white/10" />
						{:else}
							<div class="w-8 h-8 rounded-full bg-navy-800 shrink-0 flex items-center justify-center text-sm">🏈</div>
						{/if}
						<div class="flex-1 min-w-0">
							<p class="text-sm text-white font-semibold truncate">{txn.teamName}</p>
							<p class="text-xs text-navy-500 truncate">{txn.reason}</p>
						</div>
						<div class="text-right shrink-0">
							<p class="font-mono font-bold text-sm {txn.amount >= 0 ? 'text-green-400' : 'text-red-400'}">{fmtFaab(txn.amount)}</p>
							<p class="text-[10px] text-navy-500">{fmtDate(txn.createdAt)}</p>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>
