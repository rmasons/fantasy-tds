<script lang="ts">
	import type { LayoutData } from '../$types';
	import type { SlimPlayer } from '$lib/types';
	import {
		fetchLeagueCore,
		fetchNflState,
		fetchMatchups,
		fetchTransactions,
		buildRosterInfoMap,
		fetchDisplayNameOverrides,
		fetchUser,
		avatarUrl,
	} from '$lib/sleeper';
	import { computeForSeason } from '$lib/superlativesEngine';

	let { data } = $props<{ data: LayoutData }>();

	interface SeasonEntry {
		season: string;
		teamName: string;
		avatar: string | null;
		stat: string;
		sub?: string;
	}

	interface Superlative {
		key: string;
		emoji: string;
		title: string;
		desc: string;
		entries: SeasonEntry[];
	}

	const SUP_DEFS = [
		{ key: 'big_hairy', emoji: '🏈', title: 'Big Hairy American Winning Machine', desc: 'Regular Season Champion' },
		{ key: 'big_red', emoji: '💥', title: 'Big Red', desc: 'Biggest Blowout Win' },
		{ key: 'pepe', emoji: '💔', title: 'Break It, Pepe Le Pew', desc: 'Highest Score in a Loss' },
		{ key: 'chubby', emoji: '💪', title: 'Chubby', desc: 'Highest Average Margin of Victory' },
		{ key: 'ricky_bobby', emoji: '🏁', title: "Don't you put that Evil on me, Ricky Bobby!", desc: 'Most Injured Players' },
		{ key: 'drive_heart', emoji: '🏹', title: 'Drive with Your Heart', desc: 'Most Efficient Manager' },
		{ key: 'hakuna', emoji: '⚡', title: 'Hakuna Matata, Bitches', desc: 'Highest Single-Week Score' },
		{ key: 'hard_diamond', emoji: '💎', title: 'Hard as a Diamond in an Ice Storm', desc: 'Most Points Against' },
		{ key: 'target', emoji: '🛒', title: "I got it at Target. It's on Sale.", desc: 'Best Waiver Wire / FA Add' },
		{ key: 'piss_excellence', emoji: '👑', title: 'I Piss Excellence', desc: 'Highest Average Weekly Score' },
		{ key: 'on_fire', emoji: '🔥', title: "I'm on Fire!", desc: 'Longest Win Streak' },
		{ key: 'last_place', emoji: '🚽', title: "It's Not Always Bad to Be in Last Place", desc: 'Regular Season Last Place' },
		{ key: '18', emoji: '🔞', title: 'Please be 18', desc: 'Most Unique Rookies Started' },
		{ key: 'ten_years_ii', emoji: '🏈', title: '10 Years Old', desc: 'Most Total Rookie Starts' },
		{ key: 'see_you_grown', emoji: '🌱', title: "See You When You're Grown", desc: 'Best Record to Miss Playoffs' },
		{ key: 'spider_monkey', emoji: '🐒', title: 'Spider Monkey', desc: 'Most Points For' },
		{ key: 'magic_man', emoji: '🎩', title: 'Magic Man', desc: 'Lowest Average Margin of Victory' },
		{ key: 'not_good', emoji: '❄️', title: 'This is not Good', desc: 'Longest Losing Streak' },
		{ key: 'too_drunk', emoji: '🍗', title: 'Too Drunk to Taste This Chicken', desc: 'Biggest Blowout Loss' },
		{ key: 'he_was_man', emoji: '🧓', title: 'He was a Man', desc: 'Most Experienced Starting Lineup' },
		{ key: 'wild_horses', emoji: '🐎', title: 'Break Us Like Wild Horses', desc: 'Lowest Single-Week Score' },
		{ key: 'confused', emoji: '🤔', title: 'Confused By Your Tactics', desc: 'Best Performer Without a Superlative' },
	];

	// ── State ─────────────────────────────────────────────────────────────────

	let loading = $state(true);
	let loadingStatus = $state('Loading…');
	let error = $state('');
	let superlatives = $state<Superlative[]>([]);
	let failedVideos = $state(new Set<string>());

	$effect(() => {
		const leagueId = data.leagueId;
		loading = true;
		loadingStatus = 'Loading…';
		error = '';
		superlatives = [];

		(async () => {
			try {
				loadingStatus = 'Fetching league data…';
				const [{ league, rosters, users }, nfl, playersData, historicalRes] = await Promise.all([
					fetchLeagueCore(leagueId),
					fetchNflState(),
					fetch('/api/players').then(r => r.json()) as Promise<Record<string, SlimPlayer>>,
					fetch(`/api/superlatives/${leagueId}`).then(r => r.ok ? r.json() : { history: [] }),
				]);
				if (data.leagueId !== leagueId) return;

				const supMap = new Map<string, SeasonEntry[]>();

				// ── Historical seasons from Firestore ─────────────────
				type StoredEntry = { ownerId?: string; teamName?: string; stat: string; sub?: string };
				const history: Array<{ season: string; awards: Record<string, StoredEntry> }> =
					historicalRes?.history ?? [];

				// Resolve Sleeper usernames → display name + avatar
				const uniqueOwnerIds = [...new Set(
					history.flatMap(h => Object.values(h.awards).map(a => a.ownerId).filter(Boolean))
				)] as string[];

				const ownerDisplayMap = new Map<string, { teamName: string; avatar: string | null }>();
				if (uniqueOwnerIds.length > 0) {
					const profiles = await Promise.all(uniqueOwnerIds.map(u => fetchUser(u).catch(() => null)));
					if (data.leagueId !== leagueId) return;

					const idMap = new Map<string, { userId: string; displayName: string; avatar: string | null }>();
					const resolvedIds: string[] = [];
					for (let i = 0; i < uniqueOwnerIds.length; i++) {
						const p = profiles[i];
						if (p) { idMap.set(uniqueOwnerIds[i], { userId: p.user_id, displayName: p.display_name, avatar: avatarUrl(p.avatar) }); resolvedIds.push(p.user_id); }
					}

					const histOverrides = await fetchDisplayNameOverrides(resolvedIds);
					if (data.leagueId !== leagueId) return;

					for (const [username, { userId, displayName, avatar }] of idMap) {
						ownerDisplayMap.set(username, { teamName: histOverrides.get(userId) ?? displayName, avatar });
					}
				}

				for (const { season, awards } of history) {
					if (season === league.season) continue;
					for (const [key, entry] of Object.entries(awards)) {
						const resolved = entry.ownerId ? ownerDisplayMap.get(entry.ownerId) : null;
						const arr = supMap.get(key) ?? [];
						arr.push({
							season,
							teamName: resolved?.teamName ?? entry.teamName ?? entry.ownerId ?? '',
							avatar: resolved?.avatar ?? null,
							stat: entry.stat,
							sub: entry.sub,
						});
						supMap.set(key, arr);
					}
				}

				// ── Current season from Sleeper ────────────────────────
				if (nfl.season_type !== 'pre') {
					const playoffStart: number = league.settings?.playoff_week_start ?? 15;
					const maxWeek = Math.min(nfl.week, playoffStart - 1);

					if (maxWeek >= 1) {
						loadingStatus = `Loading ${league.season}…`;
						const overrides = await fetchDisplayNameOverrides(users.map(u => u.user_id));
						if (data.leagueId !== leagueId) return;

						const rosterInfoMap = buildRosterInfoMap(rosters, users, overrides);
						const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);

						const [matchupWeeks, txWeeks] = await Promise.all([
							Promise.all(weeks.map(w => fetchMatchups(leagueId, w).catch(() => []))),
							Promise.all(weeks.map(w => fetchTransactions(leagueId, w).catch(() => []))),
						]);
						if (data.leagueId !== leagueId) return;

						const seasonResult = computeForSeason(league, rosters, rosterInfoMap, matchupWeeks, txWeeks, playersData);
						for (const [key, entry] of seasonResult) {
							const arr = supMap.get(key) ?? [];
							arr.push({ season: league.season, teamName: entry.teamName, avatar: entry.avatar, stat: entry.stat, sub: entry.sub });
							supMap.set(key, arr);
						}
					}
				}

				superlatives = SUP_DEFS
					.map(def => ({
						...def,
						entries: (supMap.get(def.key) ?? []).sort((a, b) => b.season.localeCompare(a.season)),
					}))
					.filter(s => s.entries.length > 0);

			} catch (e: any) {
				if (data.leagueId !== leagueId) return;
				error = e.message;
			} finally {
				if (data.leagueId !== leagueId) return;
				loading = false;
			}
		})();
	});
</script>

<div>
	<div class="mb-6">
		<h1 class="font-sport font-black text-5xl uppercase tracking-tight text-white leading-none">Superlatives</h1>
	</div>

	{#if loading}
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
			{#each Array(12) as _}
				<div class="bg-navy-850 rounded-lg border border-navy-700 overflow-hidden">
					<div class="p-4 border-b border-navy-700/40">
						<div class="h-5 bg-navy-700 rounded animate-pulse w-3/4 mb-2"></div>
						<div class="h-3 bg-navy-800 rounded animate-pulse w-1/2"></div>
					</div>
					<div class="h-40 bg-navy-900 animate-pulse"></div>
					<div class="divide-y divide-navy-700/30">
						{#each Array(3) as _}
							<div class="flex items-center gap-2 px-4 py-2.5">
								<div class="w-9 h-3 bg-navy-700 rounded animate-pulse shrink-0"></div>
								<div class="w-6 h-6 rounded-full bg-navy-700 animate-pulse shrink-0"></div>
								<div class="h-3 bg-navy-700 rounded animate-pulse flex-1"></div>
								<div class="w-14 h-3 bg-navy-800 rounded animate-pulse shrink-0"></div>
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
		<p class="text-navy-500 text-sm mt-4 italic">{loadingStatus}</p>
	{:else if error}
		<p class="text-red-400">Failed to load superlatives: {error}</p>
	{:else if superlatives.length === 0}
		<div class="bg-navy-850 rounded-xl border border-navy-700 p-10 text-center">
			<p class="text-4xl mb-3">🏈</p>
			<p class="text-slate-400">No completed games yet.</p>
			<p class="text-navy-500 text-sm mt-1">Check back once the season is underway.</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
			{#each superlatives as s (s.key)}
				<div class="bg-navy-850 rounded-lg border border-navy-700 overflow-hidden flex flex-col">

					<!-- Award title at top -->
					<div class="px-4 pt-4 pb-3 border-b border-navy-700/50">
						<div class="flex items-start gap-2">
							<span class="text-2xl leading-none shrink-0 mt-0.5">{s.emoji}</span>
							<div>
								<p class="font-sport font-black uppercase tracking-wide text-amber-400 text-xl leading-tight">{s.title}</p>
								<p class="text-[10px] text-navy-500 uppercase tracking-widest mt-0.5 leading-snug">{s.desc}</p>
							</div>
						</div>
					</div>

					<!-- Video centered -->
					{#if !failedVideos.has(s.key)}
						<div class="flex items-center justify-center bg-navy-900 overflow-hidden h-44">
							<video
								src="/superlatives/{s.key}.mp4"
								autoplay loop muted playsinline
								class="h-full w-full object-contain"
								onerror={() => { failedVideos = new Set([...failedVideos, s.key]); }}
							></video>
						</div>
					{/if}

					<!-- Season standings grid -->
					<div class="divide-y divide-navy-700/30">
						{#each s.entries as e (e.season)}
							<div class="flex items-center gap-2.5 px-4 py-2">
								<span class="text-xs font-mono font-bold text-navy-400 w-9 shrink-0">{e.season}</span>
								{#if e.teamName === '—'}
									<div class="w-6 h-6 rounded-full bg-navy-800/50 shrink-0"></div>
									<span class="text-sm text-navy-600 truncate flex-1 italic">Not awarded</span>
								{:else}
									{#if e.avatar}
										<img src={e.avatar} alt="" class="w-6 h-6 rounded-full shrink-0 object-cover" />
									{:else}
										<div class="w-6 h-6 rounded-full bg-navy-800 shrink-0"></div>
									{/if}
									<span class="text-sm text-white truncate flex-1 font-medium leading-tight">{e.teamName}</span>
									<span class="text-xs font-mono text-amber-400/80 shrink-0 tabular-nums">{e.stat}</span>
								{/if}
							</div>
						{/each}
					</div>

				</div>
			{/each}
		</div>
	{/if}
</div>
