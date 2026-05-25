<script lang="ts">
	import type { LayoutData } from '../../$types';

	let { data } = $props<{ data: LayoutData }>();

	const AWARD_LABELS: Record<string, string> = {
		big_hairy:       'Big Hairy American Winning Machine',
		big_red:         'Big Red',
		pepe:            'Break It, Pepé Le Pew',
		chubby:          'Chubby',
		ricky_bobby:     "Don't you put that Evil on me, Ricky Bobby!",
		drive_heart:     'Drive with Your Heart',
		hakuna:          'Hakuna Matata, Bitches',
		hard_diamond:    'Hard as a Diamond in an Ice Storm',
		target:          "I got it at Target. It's on Sale.",
		piss_excellence: 'I Piss Excellence',
		on_fire:         "I'm on Fire!",
		last_place:      "It's Not Always Bad to Be in Last Place",
		'18':            'Please be 18',
		ten_years_ii:    '10 Years Old',
		see_you_grown:   "See You When You're Grown",
		spider_monkey:   'Spider Monkey',
		magic_man:       'Magic Man',
		not_good:        'This is not Good',
		too_drunk:       'Too Drunk to Taste This Chicken',
		he_was_man:      'He was a Man',
		wild_horses:     'Break Us Like Wild Horses',
		confused:        'Confused By Your Tactics',
	};

	type AwardEntry = { ownerId?: string; teamName?: string; stat: string };

	// Pre-loaded historical data — ownerId is Sleeper username; Ryan has no account on file
	const seasons: Array<{ season: string; awards: Record<string, AwardEntry> }> = [
		{
			season: '2025',
			awards: {
				big_hairy:       { ownerId: 'rmasons',       stat: '' },
				big_red:         { ownerId: 'GriffDaGreat',  stat: '' },
				pepe:            { ownerId: 'UB400',         stat: '' },
				chubby:          { ownerId: 'GriffDaGreat',  stat: '' },
				ricky_bobby:     { ownerId: 'ItsATravisty',  stat: '' },
				drive_heart:     { ownerId: 'UB400',         stat: '' },
				hakuna:          { ownerId: 'GriffDaGreat',  stat: '' },
				hard_diamond:    { ownerId: 'blspain003',    stat: '' },
				target:          { ownerId: 'ItsATravisty',  stat: '' },
				piss_excellence: { ownerId: 'GriffDaGreat',  stat: '' },
				on_fire:         { ownerId: 'GriffDaGreat',  stat: '' },
				last_place:      { ownerId: 'ItsATravisty',  stat: '' },
				'18':            { ownerId: 'EmpireofDirt',  stat: '' },
				ten_years_ii:    { ownerId: 'IWantSomeButts', stat: '' },
				see_you_grown:   { ownerId: 'aspear3',       stat: '' },
				spider_monkey:   { ownerId: 'GriffDaGreat',  stat: '' },
				magic_man:       { ownerId: 'EmpireofDirt',  stat: '' },
				not_good:        { ownerId: 'EmpireofDirt',  stat: '' },
				too_drunk:       { ownerId: 'blspain003',    stat: '' },
				he_was_man:      { ownerId: 'GriffDaGreat',  stat: '' },
				wild_horses:     { ownerId: 'ItsATravisty',  stat: '' },
				confused:        { ownerId: 'catrussell',    stat: '' },
			},
		},
		{
			season: '2024',
			awards: {
				big_hairy:       { ownerId: 'EmpireofDirt',  stat: '' },
				big_red:         { ownerId: 'EmpireofDirt',  stat: '' },
				pepe:            { ownerId: 'rmasons',       stat: '' },
				chubby:          { ownerId: 'EmpireofDirt',  stat: '' },
				ricky_bobby:     { ownerId: 'UB400',         stat: '' },
				drive_heart:     { ownerId: 'catrussell',    stat: '' },
				hakuna:          { ownerId: 'EmpireofDirt',  stat: '' },
				hard_diamond:    { ownerId: 'RyJohn',        stat: '' },
				target:          { ownerId: 'MadelynShaw',   stat: '' },
				piss_excellence: { ownerId: 'aspear3',       stat: '' },
				on_fire:         { teamName: 'Conner & Jared', stat: '' },
				last_place:      { ownerId: 'RyJohn',        stat: '' },
				'18':            { ownerId: 'EmpireofDirt',  stat: '' },
				ten_years_ii:    { ownerId: 'UB400',         stat: '' },
				see_you_grown:   { ownerId: 'UB400',         stat: '' },
				spider_monkey:   { ownerId: 'aspear3',       stat: '' },
				magic_man:       { ownerId: 'RyJohn',        stat: '' },
				not_good:        { teamName: 'Griff & Ryan', stat: '' },
				too_drunk:       { ownerId: 'IWantSomeButts', stat: '' },
				he_was_man:      { ownerId: 'aspear3',       stat: '' },
				wild_horses:     { ownerId: 'ItsATravisty',  stat: '' },
				confused:        { ownerId: 'blspain003',    stat: '' },
			},
		},
		{
			season: '2023',
			awards: {
				big_hairy:       { ownerId: 'aspear3',        stat: '' },
				big_red:         { ownerId: 'kerrveball',     stat: '' },
				pepe:            { teamName: '—',             stat: '' },
				chubby:          { ownerId: 'aspear3',        stat: '' },
				ricky_bobby:     { teamName: '—',             stat: '' },
				drive_heart:     { ownerId: 'MadelynShaw',    stat: '' },
				hakuna:          { teamName: '—',             stat: '' },
				hard_diamond:    { ownerId: 'RyJohn',         stat: '' },
				target:          { ownerId: 'GriffDaGreat',   stat: '' },
				piss_excellence: { ownerId: 'MadelynShaw',    stat: '' },
				on_fire:         { ownerId: 'aspear3',        stat: '' },
				last_place:      { ownerId: 'IWantSomeButts', stat: '' },
				'18':            { ownerId: 'rmasons',        stat: '' },
				ten_years_ii:    { ownerId: 'rmasons',        stat: '' },
				see_you_grown:   { ownerId: 'EmpireofDirt',   stat: '' },
				spider_monkey:   { ownerId: 'kerrveball',     stat: '' },
				magic_man:       { teamName: '—',             stat: '' },
				not_good:        { ownerId: 'IWantSomeButts', stat: '' },
				too_drunk:       { ownerId: 'RyJohn',         stat: '' },
				he_was_man:      { teamName: '—',             stat: '' },
				wild_horses:     { teamName: '—',             stat: '' },
				confused:        { teamName: '—',             stat: '' },
			},
		},
	];

	let status = $state<Record<string, 'idle' | 'saving' | 'done' | 'error'>>({
		'2023': 'idle', '2024': 'idle', '2025': 'idle',
	});
	let computeStatus = $state<'idle' | 'running' | 'done' | 'error'>('idle');
	let computeResult = $state('');

	async function saveAll() {
		for (const { season, awards } of seasons) {
			status[season] = 'saving';
			try {
				const res = await fetch(`/api/superlatives/${data.leagueId}`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ season, awards }),
				});
				status[season] = res.ok ? 'done' : 'error';
			} catch {
				status[season] = 'error';
			}
		}
	}

	async function computeStats() {
		computeStatus = 'running';
		computeResult = '';
		try {
			const res = await fetch(`/api/superlatives/${data.leagueId}`, { method: 'PUT' });
			if (res.ok) {
				const body = await res.json();
				const summary = (body.seasons as Array<{ season: string; computed: number }>)
					.map(s => `${s.season}: ${s.computed} awards`)
					.join(' · ');
				computeResult = summary || 'Done';
				computeStatus = 'done';
			} else {
				computeResult = `Error ${res.status}`;
				computeStatus = 'error';
			}
		} catch (e: any) {
			computeResult = e.message ?? 'Network error';
			computeStatus = 'error';
		}
	}

	const allDone = $derived(Object.values(status).every(s => s === 'done'));
	const anySaving = $derived(Object.values(status).some(s => s === 'saving'));
</script>

<div>
	<div class="mb-6">
		<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">Import Superlatives</h1>
		<p class="text-navy-500 text-sm mt-1">Saves historical award recipients to Firestore · league {data.leagueId}</p>
	</div>

	{#if !data.user?.isAdmin}
		<div class="bg-red-900/30 border border-red-800 rounded-lg p-6 text-red-300">
			Admin access required.
		</div>
	{:else}
		<div class="space-y-6 mb-8">
			{#each seasons as { season, awards }}
				<div class="bg-navy-850 rounded-lg border border-navy-700 overflow-hidden">
					<div class="flex items-center gap-3 px-4 py-3 border-b border-navy-700/50">
						<span class="font-sport font-black text-2xl text-amber-400">{season}</span>
						{#if status[season] === 'done'}
							<span class="text-xs text-green-400 font-semibold">✓ Saved</span>
						{:else if status[season] === 'error'}
							<span class="text-xs text-red-400 font-semibold">✗ Error</span>
						{:else if status[season] === 'saving'}
							<span class="text-xs text-navy-400 italic">Saving…</span>
						{/if}
					</div>
					<div class="divide-y divide-navy-700/30">
						{#each Object.entries(awards) as [key, entry]}
							<div class="flex items-center gap-3 px-4 py-2">
								<span class="text-xs text-navy-400 w-44 shrink-0 truncate">{AWARD_LABELS[key] ?? key}</span>
								<span class="text-sm text-white font-medium">{entry.ownerId ?? entry.teamName}</span>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>

		<div class="flex flex-wrap items-center gap-4">
			{#if allDone}
				<div class="flex items-center gap-2 text-green-400 font-semibold">
					✓ All seasons saved to Firestore
				</div>
				<a href="/league/{data.leagueId}/superlatives" class="text-sm text-amber-400 hover:text-amber-300 underline">
					View superlatives →
				</a>
			{:else}
				<button
					onclick={saveAll}
					disabled={anySaving}
					class="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed
					       text-navy-950 font-sport font-bold uppercase tracking-wide rounded-lg transition-colors"
				>
					{anySaving ? 'Saving…' : 'Save All Seasons'}
				</button>
				<p class="text-xs text-navy-500">Writes 2023, 2024, and 2025 to Firestore under league {data.leagueId}</p>
			{/if}

			<div class="flex items-center gap-3 border-l border-navy-700 pl-4 ml-0">
				<button
					onclick={computeStats}
					disabled={computeStatus === 'running'}
					class="px-6 py-2.5 bg-navy-700 hover:bg-navy-600 disabled:opacity-50 disabled:cursor-not-allowed
					       text-white font-sport font-bold uppercase tracking-wide rounded-lg transition-colors"
				>
					{computeStatus === 'running' ? 'Computing…' : 'Compute Stats from Sleeper'}
				</button>
				{#if computeStatus === 'done'}
					<span class="text-xs text-green-400 font-semibold">✓ {computeResult}</span>
				{:else if computeStatus === 'error'}
					<span class="text-xs text-red-400">{computeResult}</span>
				{:else if computeStatus === 'idle'}
					<span class="text-xs text-navy-500">Fills stat values from Sleeper matchup history</span>
				{/if}
			</div>
		</div>
	{/if}
</div>
