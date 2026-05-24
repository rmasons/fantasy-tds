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
		combineFpts,
	} from '$lib/sleeper';

	let { data } = $props<{ data: LayoutData }>();

	interface SupEntry {
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
		entry: SupEntry | null;
	}

	let loading = $state(true);
	let loadingStatus = $state('Loading…');
	let error = $state('');
	let season = $state('');
	let superlatives = $state<Superlative[]>([]);
	let noGames = $state(false);
	let failedVideos = $state(new Set<string>());

	$effect(() => {
		const leagueId = data.leagueId;
		loading = true;
		loadingStatus = 'Loading…';
		error = '';
		season = '';
		superlatives = [];
		noGames = false;

		(async () => {
			try {
				loadingStatus = 'Fetching league data…';
				const [{ league, rosters, users }, nfl, playersData] = await Promise.all([
					fetchLeagueCore(leagueId),
					fetchNflState(),
					fetch('/api/players').then(r => r.json()) as Promise<Record<string, SlimPlayer>>,
				]);
				if (data.leagueId !== leagueId) return;

				season = league.season;

				if (nfl.season_type === 'pre') {
					noGames = true;
					return;
				}

				const overrides = await fetchDisplayNameOverrides(users.map(u => u.user_id));
				if (data.leagueId !== leagueId) return;

				const rosterInfoMap = buildRosterInfoMap(rosters, users, overrides);
				const playoffStart: number = league.settings?.playoff_week_start ?? 15;
				const playoffTeamCount: number = (league.settings as any)?.playoff_teams ?? 4;

				const maxRegWeek = nfl.season_type === 'regular'
					? Math.min(nfl.week, playoffStart - 1)
					: playoffStart - 1;

				if (maxRegWeek < 1) {
					noGames = true;
					return;
				}

				const weeks = Array.from({ length: maxRegWeek }, (_, i) => i + 1);

				loadingStatus = 'Fetching matchup & transaction data…';
				const [matchupWeeks, txWeeks] = await Promise.all([
					Promise.all(weeks.map(w => fetchMatchups(leagueId, w).catch(() => []))),
					Promise.all(weeks.map(w => fetchTransactions(leagueId, w).catch(() => []))),
				]);
				if (data.leagueId !== leagueId) return;

				loadingStatus = 'Computing superlatives…';

				// ── Helpers ───────────────────────────────────────────────────
				function toEntry(rid: number, stat: string, sub?: string): SupEntry {
					const i = rosterInfoMap.get(rid);
					return { teamName: i?.teamName ?? `Team ${rid}`, avatar: i?.avatar ?? null, stat, sub };
				}

				function recordStr(wins: number, losses: number, ties: number): string {
					return ties > 0 ? `${wins}–${losses}–${ties}` : `${wins}–${losses}`;
				}

				// ── Rosters sorted by regular season standing ─────────────────
				const rostersByRecord = [...rosters].sort((a, b) => {
					const wA = a.settings.wins ?? 0, wB = b.settings.wins ?? 0;
					if (wA !== wB) return wB - wA;
					return combineFpts(b.settings.fpts ?? 0, b.settings.fpts_decimal ?? 0)
						- combineFpts(a.settings.fpts ?? 0, a.settings.fpts_decimal ?? 0);
				});

				// ── Weekly scores + matchup pairs ─────────────────────────────
				interface WeekScore {
					week: number;
					rid: number;
					pts: number;
					starters: string[];
					players: string[];
					playersPoints: Record<string, number>;
				}
				interface Pair {
					week: number;
					winRid: number;
					loseRid: number;
					winPts: number;
					losePts: number;
					margin: number;
				}

				const weekScores: WeekScore[] = [];
				const pairs: Pair[] = [];

				for (let wi = 0; wi < weeks.length; wi++) {
					const w = weeks[wi];
					const wm: any[] = (matchupWeeks[wi] as any[]) ?? [];

					for (const m of wm) {
						weekScores.push({
							week: w,
							rid: m.roster_id,
							pts: m.points ?? 0,
							starters: m.starters ?? [],
							players: m.players ?? [],
							playersPoints: m.players_points ?? {},
						});
					}

					const groups: Record<number, any[]> = {};
					for (const m of wm) {
						if (!m.matchup_id) continue;
						(groups[m.matchup_id] ??= []).push(m);
					}
					for (const pair of Object.values(groups)) {
						if (pair.length !== 2) continue;
						const [a, b] = pair;
						const pA = a.points ?? 0, pB = b.points ?? 0;
						if (pA === 0 && pB === 0) continue;
						if (pA !== pB) {
							const [win, lose, wP, lP] = pA > pB ? [a, b, pA, pB] : [b, a, pB, pA];
							pairs.push({ week: w, winRid: win.roster_id, loseRid: lose.roster_id, winPts: wP, losePts: lP, margin: wP - lP });
						}
					}
				}

				// ── Starter index for fast waiver lookup ──────────────────────
				const starterIdx = new Map<string, Array<{ week: number; pts: number }>>();
				for (const s of weekScores) {
					for (const pid of s.starters) {
						const key = `${pid}_${s.rid}`;
						if (!starterIdx.has(key)) starterIdx.set(key, []);
						starterIdx.get(key)!.push({ week: s.week, pts: s.playersPoints[pid] ?? 0 });
					}
				}

				// ── Waiver/FA adds (earliest add week per player+roster) ──────
				const waiverAdds = new Map<string, { rosterId: number; playerId: string; week: number }>();
				for (let wi = 0; wi < weeks.length; wi++) {
					for (const tx of ((txWeeks[wi] as any[]) ?? [])) {
						if (tx.status !== 'complete') continue;
						if (tx.type !== 'waiver' && tx.type !== 'free_agent') continue;
						for (const [pid, rid] of Object.entries(tx.adds ?? {})) {
							const key = `${pid}_${rid}`;
							if (!waiverAdds.has(key)) waiverAdds.set(key, { rosterId: rid as number, playerId: pid, week: weeks[wi] });
						}
					}
				}

				// ── Superlative builder (tracks winner rids for CONFUSED) ─────
				const sups: Superlative[] = [];
				const winnerRids = new Set<number>();

				function sup(key: string, emoji: string, title: string, desc: string, entry: SupEntry | null, winnerRid?: number) {
					sups.push({ key, emoji, title, desc, entry });
					if (winnerRid !== undefined) winnerRids.add(winnerRid);
				}

				// ── 1. Big Hairy American Winning Machine — Regular Season Winner
				{
					const r = rostersByRecord[0];
					if (r) {
						const w = r.settings.wins ?? 0, l = r.settings.losses ?? 0, t = r.settings.ties ?? 0;
						sup('big_hairy', '🏈', 'Big Hairy American Winning Machine', 'Regular Season Champion',
							toEntry(r.roster_id, recordStr(w, l, t)), r.roster_id);
					} else {
						sup('big_hairy', '🏈', 'Big Hairy American Winning Machine', 'Regular Season Champion', null);
					}
				}

				// ── 2. Big Red — Biggest Blowout Win
				{
					const best = pairs.reduce<Pair | null>((b, p) => !b || p.margin > b.margin ? p : b, null);
					sup('big_red', '💥', 'Big Red', 'Biggest Blowout Win', best
						? toEntry(best.winRid, `+${best.margin.toFixed(2)} pts`,
							`Wk ${best.week} vs ${rosterInfoMap.get(best.loseRid)?.teamName ?? `Team ${best.loseRid}`}`)
						: null, best?.winRid);
				}

				// ── 3. Break It, Pepe Le Pew — Highest Score in a Loss
				{
					const best = pairs.reduce<Pair | null>((b, p) => !b || p.losePts > b.losePts ? p : b, null);
					sup('pepe', '💔', 'Break It, Pepe Le Pew', 'Highest Score in a Loss',
						best ? toEntry(best.loseRid, best.losePts.toFixed(2) + ' pts', `Week ${best.week}`) : null,
						best?.loseRid);
				}

				// ── 4. Chubby — Highest Average Margin of Victory
				{
					const m = new Map<number, { sum: number; n: number }>();
					for (const p of pairs) {
						const c = m.get(p.winRid) ?? { sum: 0, n: 0 };
						m.set(p.winRid, { sum: c.sum + p.margin, n: c.n + 1 });
					}
					const best = [...m.entries()].reduce<{ rid: number; avg: number } | null>((b, [rid, { sum, n }]) => {
						const avg = sum / n;
						return !b || avg > b.avg ? { rid, avg } : b;
					}, null);
					sup('chubby', '💪', 'Chubby', 'Highest Average Margin of Victory',
						best ? toEntry(best.rid, `+${best.avg.toFixed(2)} avg margin`) : null, best?.rid);
				}

				// ── 5. Drive with Your Heart — Most Efficient Manager
				{
					const rosterPositions: string[] = league.roster_positions ?? [];
					const posCounts: Record<string, number> = {};
					const flexSlots: string[] = [];
					for (const pos of rosterPositions) {
						if (pos === 'BN' || pos === 'IR') continue;
						if (['FLEX', 'WRRB_FLEX', 'REC_FLEX', 'SUPER_FLEX'].includes(pos)) {
							flexSlots.push(pos);
						} else {
							posCounts[pos] = (posCounts[pos] ?? 0) + 1;
						}
					}

					let best: { rid: number; eff: number } | null = null;
					if (rosterPositions.length > 0) {
						const m = new Map<number, { startedSum: number; maxSum: number }>();
						for (const s of weekScores) {
							if (s.players.length === 0) continue;
							const startedPts = s.starters.reduce((sum, pid) => sum + (s.playersPoints[pid] ?? 0), 0);

							const byPos: Record<string, Array<{ pid: string; pts: number }>> = {};
							for (const pid of s.players) {
								const pos = playersData[pid]?.pos ?? '?';
								(byPos[pos] ??= []).push({ pid, pts: s.playersPoints[pid] ?? 0 });
							}
							for (const pos in byPos) byPos[pos].sort((a, b) => b.pts - a.pts);

							const used = new Set<string>();
							let maxPts = 0;
							for (const [pos, cnt] of Object.entries(posCounts)) {
								for (let i = 0; i < cnt; i++) {
									const pool = byPos[pos] ?? [];
									if (i < pool.length) { used.add(pool[i].pid); maxPts += pool[i].pts; }
								}
							}
							for (const flexType of flexSlots) {
								const eligible = flexType === 'SUPER_FLEX' ? ['QB', 'WR', 'RB', 'TE']
									: flexType === 'REC_FLEX' ? ['WR', 'TE']
									: ['WR', 'RB', 'TE'];
								const candidates = eligible
									.flatMap(p => (byPos[p] ?? []).filter(x => !used.has(x.pid)))
									.sort((a, b) => b.pts - a.pts);
								if (candidates.length > 0) { used.add(candidates[0].pid); maxPts += candidates[0].pts; }
							}

							if (maxPts > 0) {
								const c = m.get(s.rid) ?? { startedSum: 0, maxSum: 0 };
								m.set(s.rid, { startedSum: c.startedSum + startedPts, maxSum: c.maxSum + maxPts });
							}
						}
						best = [...m.entries()].reduce<{ rid: number; eff: number } | null>((b, [rid, { startedSum, maxSum }]) => {
							const eff = startedSum / maxSum;
							return !b || eff > b.eff ? { rid, eff } : b;
						}, null);
					}
					sup('drive_heart', '🏹', 'Drive with Your Heart', 'Most Efficient Manager',
						best ? toEntry(best.rid, (best.eff * 100).toFixed(2) + '%') : null, best?.rid);
				}

				// ── 6. Hakuna Matata, Bitches — Highest Single-Week Score
				{
					const best = weekScores.reduce<WeekScore | null>((b, s) => !b || s.pts > b.pts ? s : b, null);
					sup('hakuna', '⚡', 'Hakuna Matata, Bitches', 'Highest Single-Week Score',
						best ? toEntry(best.rid, best.pts.toFixed(2) + ' pts', `Week ${best.week}`) : null,
						best?.rid);
				}

				// ── 7. Hard as a Diamond in an Ice Storm — Most Points Against
				{
					const m = new Map<number, number>();
					for (const p of pairs) {
						m.set(p.winRid, (m.get(p.winRid) ?? 0) + p.losePts);
						m.set(p.loseRid, (m.get(p.loseRid) ?? 0) + p.winPts);
					}
					const best = [...m.entries()].reduce<{ rid: number; pts: number } | null>((b, [rid, pts]) =>
						!b || pts > b.pts ? { rid, pts } : b, null);
					sup('hard_diamond', '💎', 'Hard as a Diamond in an Ice Storm', 'Most Points Against',
						best ? toEntry(best.rid, best.pts.toFixed(1) + ' pts against') : null, best?.rid);
				}

				// ── 8. I got it at Target — Best Waiver / FA Add
				{
					let best: { rosterId: number; playerId: string; pts: number; starts: number } | null = null;
					for (const [, add] of waiverAdds) {
						const entries = (starterIdx.get(`${add.playerId}_${add.rosterId}`) ?? [])
							.filter(e => e.week >= add.week);
						const pts = entries.reduce((s, e) => s + e.pts, 0);
						if (pts > 0 && (!best || pts > best.pts)) {
							best = { rosterId: add.rosterId, playerId: add.playerId, pts, starts: entries.length };
						}
					}
					sup('target', '🛒', "I got it at Target. It's on Sale.", 'Best Waiver Wire / FA Add',
						best ? toEntry(best.rosterId, best.pts.toFixed(2) + ' pts',
							`${playersData[best.playerId]?.name ?? best.playerId} · ${best.starts} starts`) : null,
						best?.rosterId);
				}

				// ── 9. I Piss Excellence — Highest Average Weekly Score
				{
					const m = new Map<number, { sum: number; n: number }>();
					for (const s of weekScores) {
						if (s.pts > 0) {
							const c = m.get(s.rid) ?? { sum: 0, n: 0 };
							m.set(s.rid, { sum: c.sum + s.pts, n: c.n + 1 });
						}
					}
					const best = [...m.entries()].reduce<{ rid: number; avg: number } | null>((b, [rid, { sum, n }]) => {
						const avg = sum / n;
						return !b || avg > b.avg ? { rid, avg } : b;
					}, null);
					sup('piss_excellence', '👑', 'I Piss Excellence', 'Highest Average Weekly Score',
						best ? toEntry(best.rid, best.avg.toFixed(2) + ' avg pts') : null, best?.rid);
				}

				// ── 10. I'm on Fire! — Longest Win Streak
				{
					let best: { rid: number; streak: number } | null = null;
					for (const r of rosters) {
						const rec = r.metadata?.record ?? '';
						const streak = rec.split('L').reduce((mx, s) => Math.max(mx, s.length), 0);
						if (!best || streak > best.streak) best = { rid: r.roster_id, streak };
					}
					sup('on_fire', '🔥', "I'm on Fire!", 'Longest Win Streak',
						best && best.streak > 0 ? toEntry(best.rid, `${best.streak} straight wins`) : null,
						best?.rid);
				}

				// ── 11. It's Not Always Bad to Be in Last Place — Regular Season Last Place
				{
					const r = rostersByRecord[rostersByRecord.length - 1];
					if (r) {
						const w = r.settings.wins ?? 0, l = r.settings.losses ?? 0, t = r.settings.ties ?? 0;
						sup('last_place', '🚽', "It's Not Always Bad to Be in Last Place", 'Regular Season Last Place',
							toEntry(r.roster_id, recordStr(w, l, t)), r.roster_id);
					} else {
						sup('last_place', '🚽', "It's Not Always Bad to Be in Last Place", 'Regular Season Last Place', null);
					}
				}

				// ── 12 + 13. 10 Years Old — Rookie Starts
				{
					const byRid = new Map<number, { starts: number; uniq: Set<string> }>();
					for (const s of weekScores) {
						for (const pid of s.starters) {
							if ((playersData[pid]?.yearsExp ?? -1) !== 0) continue;
							const c = byRid.get(s.rid) ?? { starts: 0, uniq: new Set<string>() };
							c.starts++;
							c.uniq.add(pid);
							byRid.set(s.rid, c);
						}
					}

					const bestUniq = [...byRid.entries()].reduce<{ rid: number; cnt: number } | null>((b, [rid, { uniq }]) =>
						!b || uniq.size > b.cnt ? { rid, cnt: uniq.size } : b, null);
					sup('18', '🔞', 'Please be 18', 'Most Unique Rookies Started',
						bestUniq ? toEntry(bestUniq.rid, `${bestUniq.cnt} unique rookies`) : null, bestUniq?.rid);

					const bestStarts = [...byRid.entries()].reduce<{ rid: number; starts: number; uniq: number } | null>(
						(b, [rid, { starts, uniq }]) => !b || starts > b.starts ? { rid, starts, uniq: uniq.size } : b, null);
					sup('ten_years_ii', '🏈', '10 Years Old', 'Most Total Rookie Starts',
						bestStarts ? toEntry(bestStarts.rid, `${bestStarts.starts} starts`, `${bestStarts.uniq} unique rookies`) : null,
						bestStarts?.rid);
				}

				// ── 14. See You When You're Grown — Best Record to Miss Playoffs
				{
					const nonPlayoff = rostersByRecord.slice(playoffTeamCount);
					const r = nonPlayoff[0];
					if (r) {
						const w = r.settings.wins ?? 0, l = r.settings.losses ?? 0, t = r.settings.ties ?? 0;
						sup('see_you_grown', '🌱', "See You When You're Grown", 'Best Record to Miss Playoffs',
							toEntry(r.roster_id, recordStr(w, l, t)), r.roster_id);
					} else {
						sup('see_you_grown', '🌱', "See You When You're Grown", 'Best Record to Miss Playoffs', null);
					}
				}

				// ── 15. Spider Monkey — Most Points For
				{
					const m = new Map<number, number>();
					for (const s of weekScores) m.set(s.rid, (m.get(s.rid) ?? 0) + s.pts);
					const best = [...m.entries()].reduce<{ rid: number; pts: number } | null>((b, [rid, pts]) =>
						!b || pts > b.pts ? { rid, pts } : b, null);
					sup('spider_monkey', '🐒', 'Spider Monkey', 'Most Points For',
						best ? toEntry(best.rid, best.pts.toFixed(1) + ' total pts') : null, best?.rid);
				}

				// ── 16. Magic Man — Lowest Average Margin of Victory
				{
					const m = new Map<number, { sum: number; n: number }>();
					for (const p of pairs) {
						const c = m.get(p.winRid) ?? { sum: 0, n: 0 };
						m.set(p.winRid, { sum: c.sum + p.margin, n: c.n + 1 });
					}
					const worst = [...m.entries()].reduce<{ rid: number; avg: number } | null>((b, [rid, { sum, n }]) => {
						const avg = sum / n;
						return !b || avg < b.avg ? { rid, avg } : b;
					}, null);
					sup('magic_man', '🎩', 'Magic Man', 'Lowest Average Margin of Victory',
						worst ? toEntry(worst.rid, `+${worst.avg.toFixed(2)} avg margin`) : null, worst?.rid);
				}

				// ── 17. This is not Good — Longest Losing Streak
				{
					let best: { rid: number; streak: number } | null = null;
					for (const r of rosters) {
						const rec = r.metadata?.record ?? '';
						const streak = rec.split('W').reduce((mx, s) => Math.max(mx, s.length), 0);
						if (!best || streak > best.streak) best = { rid: r.roster_id, streak };
					}
					sup('not_good', '❄️', 'This is not Good', 'Longest Losing Streak',
						best && best.streak > 0 ? toEntry(best.rid, `${best.streak} straight losses`) : null,
						best?.rid);
				}

				// ── 18. Too Drunk to Taste This Chicken — Biggest Blowout Loss
				{
					const worst = pairs.reduce<Pair | null>((b, p) => !b || p.margin > b.margin ? p : b, null);
					sup('too_drunk', '🍗', 'Too Drunk to Taste This Chicken', 'Biggest Blowout Loss', worst
						? toEntry(worst.loseRid, `−${worst.margin.toFixed(2)} pts`,
							`Wk ${worst.week} vs ${rosterInfoMap.get(worst.winRid)?.teamName ?? `Team ${worst.winRid}`}`)
						: null, worst?.loseRid);
				}

				// ── 19. He was a Man — Most Experienced Starting Lineup
				{
					const m = new Map<number, { sum: number; n: number }>();
					for (const s of weekScores) {
						for (const pid of s.starters) {
							const p = playersData[pid];
							if (!p || p.pos === 'DEF') continue;
							const c = m.get(s.rid) ?? { sum: 0, n: 0 };
							m.set(s.rid, { sum: c.sum + (p.yearsExp ?? 0), n: c.n + 1 });
						}
					}
					const best = [...m.entries()].reduce<{ rid: number; avg: number } | null>((b, [rid, { sum, n }]) => {
						const avg = sum / n;
						return !b || avg > b.avg ? { rid, avg } : b;
					}, null);
					sup('he_was_man', '🧓', 'He was a Man', 'Most Experienced Starting Lineup',
						best ? toEntry(best.rid, best.avg.toFixed(2) + ' avg yrs exp') : null, best?.rid);
				}

				// ── 20. Break Us Like Wild Horses — Lowest Single-Week Score
				{
					const worst = weekScores.filter(s => s.pts > 0)
						.reduce<WeekScore | null>((b, s) => !b || s.pts < b.pts ? s : b, null);
					sup('wild_horses', '🐎', 'Break Us Like Wild Horses', 'Lowest Single-Week Score',
						worst ? toEntry(worst.rid, worst.pts.toFixed(2) + ' pts', `Week ${worst.week}`) : null,
						worst?.rid);
				}

				// ── 21. Confused By Your Tactics — Best Performer Without a Superlative
				{
					const nonWinners = rosters
						.filter(r => !winnerRids.has(r.roster_id))
						.sort((a, b) =>
							combineFpts(b.settings.fpts ?? 0, b.settings.fpts_decimal ?? 0)
							- combineFpts(a.settings.fpts ?? 0, a.settings.fpts_decimal ?? 0));
					const r = nonWinners[0];
					if (r) {
						const pf = combineFpts(r.settings.fpts ?? 0, r.settings.fpts_decimal ?? 0);
						const w = r.settings.wins ?? 0, l = r.settings.losses ?? 0, t = r.settings.ties ?? 0;
						sup('confused', '🤔', 'Confused By Your Tactics', 'Best Performer Without a Superlative',
							toEntry(r.roster_id, pf.toFixed(1) + ' pts for', recordStr(w, l, t)));
					} else {
						sup('confused', '🤔', 'Confused By Your Tactics', 'Best Performer Without a Superlative', null);
					}
				}

				superlatives = sups;
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
		{#if season}
			<p class="text-navy-500 text-sm mt-1">{season} Season</p>
		{/if}
	</div>

	{#if loading}
		<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
			{#each Array(12) as _}
				<div class="h-36 bg-navy-850 rounded-lg animate-pulse border border-navy-700"></div>
			{/each}
		</div>
		<p class="text-navy-500 text-sm mt-4 italic">{loadingStatus}</p>
	{:else if error}
		<p class="text-red-400">Failed to load superlatives: {error}</p>
	{:else if noGames}
		<div class="bg-navy-850 rounded-xl border border-navy-700 p-10 text-center">
			<p class="text-4xl mb-3">🏈</p>
			<p class="text-slate-400">No completed games yet.</p>
			<p class="text-navy-500 text-sm mt-1">Check back once the season is underway.</p>
		</div>
	{:else}
		<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-2 gap-3">
			{#each superlatives as s (s.key)}
				{#if s.entry}
					<div class="bg-navy-850 rounded-lg border border-navy-700 overflow-hidden flex flex-col lg:flex-row">
						<!-- Video: stacked on mobile/tablet, thumbnail panel on desktop -->
						{#if !failedVideos.has(s.key)}
							<div class="flex items-center justify-center bg-navy-900 overflow-hidden h-40 lg:h-auto lg:w-52 lg:shrink-0">
								<video
									src="/superlatives/{s.key}.mp4"
									autoplay
									loop
									muted
									playsinline
									class="h-full w-full object-contain lg:object-cover"
									onerror={() => { failedVideos = new Set([...failedVideos, s.key]); }}
								></video>
							</div>
						{/if}

						<!-- Card content -->
						<div class="p-4 flex flex-col gap-2 flex-1">
							<!-- Award name + description -->
							<div>
								<div class="flex items-start gap-1.5">
									<span class="text-base leading-none shrink-0 mt-0.5">{s.emoji}</span>
									<p class="font-sport font-bold uppercase tracking-wide text-amber-400 text-sm leading-tight">{s.title}</p>
								</div>
								<p class="text-[10px] text-navy-500 uppercase tracking-widest mt-1 leading-snug ml-6">{s.desc}</p>
							</div>

							<!-- Stat + winner pinned to bottom -->
							<div class="mt-auto flex flex-col gap-2 pt-2">
								<div class="text-xl font-black tabular-nums text-white font-mono leading-none">
									{s.entry.stat}
								</div>
								<div class="flex items-center gap-2 min-w-0">
									{#if s.entry.avatar}
										<img src={s.entry.avatar} alt="" class="w-7 h-7 rounded-full shrink-0 object-cover" />
									{:else}
										<div class="w-7 h-7 rounded-full bg-navy-800 shrink-0 flex items-center justify-center text-xs">🏈</div>
									{/if}
									<div class="min-w-0">
										<p class="text-sm font-semibold text-white truncate leading-tight">{s.entry.teamName}</p>
										{#if s.entry.sub}
											<p class="text-xs text-slate-500 truncate">{s.entry.sub}</p>
										{/if}
									</div>
								</div>
							</div>
						</div>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>
