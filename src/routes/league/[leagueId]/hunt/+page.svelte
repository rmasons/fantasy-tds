<script lang="ts">
	import type { PageData } from './$types';
	import {
		EGGS,
		TOTAL_EGGS,
		DIFFICULTY_LABEL,
		DIFFICULTY_ORDER,
		type EggDifficulty,
		type EggClaim,
	} from '$lib/eggs';

	let { data } = $props<{ data: PageData }>();

	const claims = $derived(data.claims as Record<string, EggClaim>);

	// Per-egg rows in canonical order, each annotated with its claim (if any).
	const rows = $derived(
		EGGS.map((egg) => ({ ...egg, claim: claims[egg.id] ?? null })),
	);

	const foundCount = $derived(rows.filter((r) => r.claim).length);
	const remaining = $derived(TOTAL_EGGS - foundCount);

	interface Hunter {
		id: string;
		displayName: string;
		count: number;
		byDifficulty: Record<EggDifficulty, number>;
		isMe: boolean;
	}

	// Leaderboard: one entry per claimer, sorted by eggs found (desc), then name.
	const leaderboard = $derived.by(() => {
		const map = new Map<string, Hunter>();
		for (const egg of EGGS) {
			const c = claims[egg.id];
			if (!c) continue;
			let h = map.get(c.claimedBy);
			if (!h) {
				h = {
					id: c.claimedBy,
					displayName: c.displayName,
					count: 0,
					byDifficulty: { easy: 0, medium: 0, hard: 0, expert: 0 },
					isMe: data.myId != null && c.claimedBy === data.myId,
				};
				map.set(c.claimedBy, h);
			}
			h.count += 1;
			h.byDifficulty[egg.difficulty] += 1;
		}
		return [...map.values()].sort(
			(a, b) => b.count - a.count || a.displayName.localeCompare(b.displayName),
		);
	});

	// Remaining eggs grouped by difficulty — teases what's still out there.
	const remainingByDifficulty = $derived.by(() => {
		const counts: Record<EggDifficulty, number> = { easy: 0, medium: 0, hard: 0, expert: 0 };
		for (const r of rows) if (!r.claim) counts[r.difficulty] += 1;
		return counts;
	});

	const DIFFICULTY_CLASS: Record<EggDifficulty, string> = {
		easy: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300',
		medium: 'border-amber-400/40 bg-amber-400/10 text-amber-300',
		hard: 'border-orange-400/40 bg-orange-400/10 text-orange-300',
		expert: 'border-rose-400/40 bg-rose-400/10 text-rose-300',
	};

	function fmtDate(iso: string): string {
		if (!iso) return '';
		const d = new Date(iso);
		return isNaN(d.getTime())
			? ''
			: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}
</script>

<svelte:head><title>FAAB Hunt — Leaderboard</title></svelte:head>

<div>
	<!-- Header -->
	<div class="mb-6">
		<p class="text-amber-400/70 text-xs uppercase tracking-[0.2em] font-semibold mb-1">💰 Easter Egg Hunt</p>
		<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">FAAB Hunt</h1>
		<p class="text-navy-500 text-sm mt-2">Who's found the hidden $5 FAAB bonuses scattered across the site.</p>
	</div>

	<!-- Stat cards -->
	<div class="grid grid-cols-3 gap-3 mb-8">
		<div class="rounded-2xl border border-navy-700 bg-navy-850 p-4 text-center">
			<div class="font-sport font-black text-4xl text-emerald-400 leading-none">{foundCount}</div>
			<div class="text-navy-500 text-[10px] uppercase tracking-widest font-semibold mt-1.5">Found</div>
		</div>
		<div class="rounded-2xl border border-amber-500/30 bg-amber-400/5 p-4 text-center">
			<div class="font-sport font-black text-4xl text-amber-400 leading-none">{remaining}</div>
			<div class="text-navy-500 text-[10px] uppercase tracking-widest font-semibold mt-1.5">Remaining</div>
		</div>
		<div class="rounded-2xl border border-navy-700 bg-navy-850 p-4 text-center">
			<div class="font-sport font-black text-4xl text-white leading-none">${foundCount * 5}</div>
			<div class="text-navy-500 text-[10px] uppercase tracking-widest font-semibold mt-1.5">FAAB Claimed</div>
		</div>
	</div>

	<!-- Remaining-by-difficulty teaser -->
	{#if remaining > 0}
		<div class="flex flex-wrap items-center gap-2 mb-8 text-xs">
			<span class="text-navy-500 uppercase tracking-widest font-semibold">Still hidden:</span>
			{#each DIFFICULTY_ORDER as d}
				{#if remainingByDifficulty[d] > 0}
					<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border font-bold uppercase tracking-wide {DIFFICULTY_CLASS[d]}">
						{remainingByDifficulty[d]} {DIFFICULTY_LABEL[d]}
					</span>
				{/if}
			{/each}
		</div>
	{:else}
		<div class="mb-8 rounded-2xl border border-emerald-400/30 bg-emerald-400/5 p-4 text-center">
			<span class="font-sport font-black text-lg uppercase text-emerald-400">🎉 Every egg has been found!</span>
		</div>
	{/if}

	<!-- Leaderboard -->
	<h2 class="font-sport font-black text-2xl uppercase tracking-tight text-white mb-3">Leaderboard</h2>
	{#if leaderboard.length === 0}
		<div class="rounded-2xl border border-navy-700 bg-navy-850 p-8 text-center text-navy-500 mb-10">
			No eggs claimed yet. Be the first to find one!
		</div>
	{:else}
		<div class="space-y-2 mb-10">
			{#each leaderboard as h, i}
				<div class="flex items-center gap-3 rounded-xl border p-3 {h.isMe ? 'border-amber-400/50 bg-amber-400/5' : 'border-navy-700 bg-navy-850'}">
					<div class="font-sport font-black text-xl w-7 text-center {i === 0 ? 'text-amber-400' : 'text-navy-600'}">{i + 1}</div>
					<div class="flex-1 min-w-0">
						<div class="font-semibold text-white truncate">
							{h.displayName}{#if h.isMe}<span class="ml-2 text-[10px] text-amber-400 uppercase tracking-widest font-bold">You</span>{/if}
						</div>
						<div class="flex flex-wrap gap-1 mt-1">
							{#each DIFFICULTY_ORDER as d}
								{#if h.byDifficulty[d] > 0}
									<span class="inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase tracking-wide {DIFFICULTY_CLASS[d]}">
										{h.byDifficulty[d]} {DIFFICULTY_LABEL[d]}
									</span>
								{/if}
							{/each}
						</div>
					</div>
					<div class="text-right">
						<div class="font-sport font-black text-2xl text-amber-400 leading-none">{h.count}</div>
						<div class="text-navy-600 text-[9px] uppercase tracking-widest">eggs</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<!-- Egg-by-egg breakdown -->
	<h2 class="font-sport font-black text-2xl uppercase tracking-tight text-white mb-3">The Eggs</h2>
	<div class="space-y-2">
		{#each rows as r}
			<div class="flex items-center gap-3 rounded-xl border p-3 {r.claim ? 'border-navy-700 bg-navy-850' : 'border-dashed border-navy-700 bg-navy-900/40'}">
				<span class="text-2xl {r.claim ? '' : 'opacity-30 grayscale'}">🥚</span>
				<div class="flex-1 min-w-0">
					{#if r.claim}
						<div class="text-white text-sm font-medium truncate">{r.location}</div>
						<div class="text-navy-500 text-xs mt-0.5">
							Found by <span class="text-amber-400 font-semibold">{r.claim.displayName}</span>{#if fmtDate(r.claim.claimedAt)} · {fmtDate(r.claim.claimedAt)}{/if}
						</div>
					{:else}
						<div class="text-navy-500 text-sm font-medium tracking-wide">??? — still hidden</div>
						<div class="text-navy-600 text-xs mt-0.5">Location revealed once it's claimed</div>
					{/if}
				</div>
				<span class="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide {DIFFICULTY_CLASS[r.difficulty]}">
					{DIFFICULTY_LABEL[r.difficulty]}
				</span>
			</div>
		{/each}
	</div>
</div>
