<script module>
	import type { EggClaim } from '../../routes/api/faab-eggs/[leagueId]/+server';

	// Shared per-leagueId promise cache so multiple eggs on the same page share one fetch
	const claimsCache = new Map<string, Promise<Record<string, EggClaim>>>();

	function fetchClaims(leagueId: string): Promise<Record<string, EggClaim>> {
		if (!claimsCache.has(leagueId)) {
			claimsCache.set(
				leagueId,
				fetch(`/api/faab-eggs/${leagueId}`).then(r => (r.ok ? r.json() : {})).catch(() => ({})),
			);
		}
		return claimsCache.get(leagueId)!;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	let { eggId, leagueId, loggedIn } = $props<{ eggId: string; leagueId: string; loggedIn: boolean }>();

	const STORAGE_KEY = `faab_egg_${eggId}`;

	type Status = 'loading' | 'unclaimed' | 'mine' | 'other';

	let status = $state<Status>('loading');
	let claimedBy = $state('');
	let open = $state(false);
	let alreadyOpen = $state(false);
	let claiming = $state(false);
	let claimError = $state('');

	onMount(async () => {
		if (localStorage.getItem(STORAGE_KEY) === '1') {
			status = 'mine';
			return;
		}
		const claims = await fetchClaims(leagueId);
		if (claims[eggId]) {
			claimedBy = claims[eggId].displayName;
			status = 'other';
		} else {
			status = 'unclaimed';
		}
	});

	async function trigger() {
		if (claiming) return;
		claiming = true;
		claimError = '';
		try {
			const res = await fetch(`/api/faab-eggs/${leagueId}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ eggId }),
			});
			if (res.status === 401) {
				claimError = 'Sign in to claim.';
				return;
			}
			if (res.status === 409) {
				claimError = "You've already claimed your max (3). Nice hunting!";
				return;
			}
			const body = await res.json();
			if (body.won) {
				localStorage.setItem(STORAGE_KEY, '1');
				claimsCache.delete(leagueId);
				status = 'mine';
				open = true;
			} else {
				claimedBy = body.claim?.displayName ?? 'someone';
				status = 'other';
				alreadyOpen = true;
			}
		} catch {
			claimError = 'Network error — try again.';
		} finally {
			claiming = false;
		}
	}
</script>

{#if status === 'unclaimed' && loggedIn}
	<button
		onclick={trigger}
		disabled={claiming}
		aria-label="secret"
		class="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full border border-amber-400/50 bg-amber-400/10 text-amber-400 text-[10px] font-bold uppercase tracking-wide cursor-pointer hover:bg-amber-400/20 hover:border-amber-400 transition-colors select-none disabled:opacity-50"
	>💰 $5</button>
{:else if status === 'other'}
	<button
		onclick={() => { alreadyOpen = true; }}
		aria-label="already claimed"
		class="inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full border border-navy-600 bg-navy-800 text-navy-500 text-[10px] font-bold uppercase tracking-wide cursor-pointer hover:text-slate-400 transition-colors select-none"
	>💰 claimed</button>
{/if}

{#if claimError}
	<span class="ml-1 text-[10px] text-red-400">{claimError}</span>
{/if}

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background:rgba(0,0,0,0.85);backdrop-filter:blur(4px)">
		<div class="bg-navy-850 border border-amber-500/40 rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
			<div class="text-5xl mb-5">🎉</div>
			<h2 class="font-sport font-black text-3xl uppercase text-amber-400 leading-tight mb-3">Congratulations!</h2>
			<p class="text-white text-lg leading-relaxed mb-2">You found <span class="text-amber-400 font-bold">$5 of extra FAAB!</span></p>
			<p class="text-slate-400 text-sm mb-8">Send this screenshot to the league group text to claim.</p>
			<button
				onclick={() => { open = false; }}
				class="px-8 py-3 bg-amber-500 hover:bg-amber-400 text-navy-950 font-sport font-bold uppercase tracking-wide rounded-xl transition-colors text-sm"
			>Got it!</button>
		</div>
	</div>
{/if}

{#if alreadyOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background:rgba(0,0,0,0.85);backdrop-filter:blur(4px)">
		<div class="bg-navy-850 border border-navy-700 rounded-2xl p-8 max-w-sm w-full text-center shadow-2xl">
			<div class="text-5xl mb-5">😔</div>
			<h2 class="font-sport font-black text-2xl uppercase text-slate-300 leading-tight mb-3">Too Slow!</h2>
			<p class="text-slate-400 leading-relaxed mb-8">
				<span class="text-white font-semibold">{claimedBy}</span> already snagged this one. Keep hunting — there are more!
			</p>
			<button
				onclick={() => { alreadyOpen = false; }}
				class="px-8 py-3 bg-navy-700 hover:bg-navy-600 text-white font-sport font-bold uppercase tracking-wide rounded-xl transition-colors text-sm"
			>Dang!</button>
		</div>
	</div>
{/if}
