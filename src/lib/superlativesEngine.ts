import type { SleeperLeague, SleeperRoster, SlimPlayer } from './types';
import { combineFpts, type RosterInfo, type RawMatchup } from './sleeper';

export interface ComputedEntry {
	ownerId: string | null;  // Sleeper user_id (numeric string from rosterInfoMap)
	teamName: string;
	avatar: string | null;   // resolved CDN URL; null when called server-side without avatars
	stat: string;
	sub?: string;
}

interface RawTransaction {
	status: string;
	type: string;
	adds?: Record<string, number> | null;
}

export function computeForSeason(
	league: SleeperLeague,
	rosters: SleeperRoster[],
	rosterInfoMap: Map<number, RosterInfo>,
	matchupWeeks: RawMatchup[][],
	txWeeks: RawTransaction[][],
	playersData: Record<string, SlimPlayer>,
): Map<string, ComputedEntry> {
	const result = new Map<string, ComputedEntry>();
	const winnerRids = new Set<number>();

	function toEntry(rid: number, stat: string, sub?: string): ComputedEntry {
		const info = rosterInfoMap.get(rid);
		return {
			ownerId: info?.ownerId ?? null,
			teamName: info?.teamName ?? `Team ${rid}`,
			avatar: info?.avatar ?? null,
			stat,
			sub,
		};
	}

	function recordStr(w: number, l: number, t: number) {
		return t > 0 ? `${w}–${l}–${t}` : `${w}–${l}`;
	}

	function set(key: string, entry: ComputedEntry, winnerRid?: number) {
		result.set(key, entry);
		if (winnerRid !== undefined) winnerRids.add(winnerRid);
	}

	const playoffTeamCount: number = league.settings.playoff_teams ?? 4;

	const rostersByRecord = [...rosters].sort((a, b) => {
		const wA = a.settings.wins ?? 0, wB = b.settings.wins ?? 0;
		if (wA !== wB) return wB - wA;
		return combineFpts(b.settings.fpts ?? 0, b.settings.fpts_decimal ?? 0)
			- combineFpts(a.settings.fpts ?? 0, a.settings.fpts_decimal ?? 0);
	});

	interface WeekScore {
		week: number; rid: number; pts: number;
		starters: string[]; players: string[]; playersPoints: Record<string, number>;
	}
	interface Pair {
		week: number; winRid: number; loseRid: number;
		winPts: number; losePts: number; margin: number;
	}


	// Computes the maximum possible score for a week given the optimal lineup selection.
	function computeOptimalScore(s: WeekScore, posCounts: Record<string, number>, flexSlots: string[]): number {
		const byPos: Record<string, Array<{ pid: string; pts: number }>> = {};
		for (const pid of s.players) {
			const pos = playersData[pid]?.pos ?? '?';
			(byPos[pos] ??= []).push({ pid, pts: s.playersPoints[pid] ?? 0 });
		}
		for (const pos in byPos) byPos[pos].sort((a, b) => b.pts - a.pts);

		const used = new Set<string>();
		let maxPts = 0;

		for (const [pos, cnt] of Object.entries(posCounts)) {
			const pool = byPos[pos] ?? [];
			for (let i = 0; i < cnt && i < pool.length; i++) {
				used.add(pool[i].pid);
				maxPts += pool[i].pts;
			}
		}

		for (const flexType of flexSlots) {
			const eligible = flexType === 'SUPER_FLEX'
				? ['QB', 'WR', 'RB', 'TE']
				: flexType === 'REC_FLEX'
					? ['WR', 'TE']
					: ['WR', 'RB', 'TE'];
			const candidates = eligible
				.flatMap(p => (byPos[p] ?? []).filter(x => !used.has(x.pid)))
				.sort((a, b) => b.pts - a.pts);
			if (candidates.length > 0) {
				used.add(candidates[0].pid);
				maxPts += candidates[0].pts;
			}
		}

		return maxPts;
	}

	const weekScores: WeekScore[] = [];
	const pairs: Pair[] = [];

	for (let wi = 0; wi < matchupWeeks.length; wi++) {
		const w = wi + 1;
		const wm: RawMatchup[] = matchupWeeks[wi] ?? [];
		for (const m of wm) {
			weekScores.push({
				week: w, rid: m.roster_id, pts: m.points ?? 0,
				starters: m.starters ?? [], players: m.players ?? [],
				playersPoints: m.players_points ?? {},
			});
		}
		const groups: Record<number, RawMatchup[]> = {};
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

	const starterIdx = new Map<string, Array<{ week: number; pts: number }>>();
	for (const s of weekScores) {
		for (const pid of s.starters) {
			const k = `${pid}_${s.rid}`;
			if (!starterIdx.has(k)) starterIdx.set(k, []);
			starterIdx.get(k)!.push({ week: s.week, pts: s.playersPoints[pid] ?? 0 });
		}
	}

	const waiverAdds = new Map<string, { rosterId: number; playerId: string; week: number }>();
	for (let wi = 0; wi < txWeeks.length; wi++) {
		for (const tx of (txWeeks[wi] ?? [])) {
			if (tx.status !== 'complete') continue;
			if (tx.type !== 'waiver' && tx.type !== 'free_agent') continue;
			for (const [pid, rid] of Object.entries(tx.adds ?? {})) {
				const k = `${pid}_${rid}`;
				if (!waiverAdds.has(k)) waiverAdds.set(k, { rosterId: rid as number, playerId: pid, week: wi + 1 });
			}
		}
	}

	// 1. Big Hairy American Winning Machine
	{
		const r = rostersByRecord[0];
		if (r) set('big_hairy', toEntry(r.roster_id, recordStr(r.settings.wins ?? 0, r.settings.losses ?? 0, r.settings.ties ?? 0)), r.roster_id);
	}

	// 2. Big Red
	{
		const best = pairs.reduce<Pair | null>((b, p) => !b || p.margin > b.margin ? p : b, null);
		if (best) set('big_red', toEntry(best.winRid, `+${best.margin.toFixed(2)} pts`, `Wk ${best.week} vs ${rosterInfoMap.get(best.loseRid)?.teamName ?? `Team ${best.loseRid}`}`), best.winRid);
	}

	// 3. Break It, Pepe Le Pew
	{
		const best = pairs.reduce<Pair | null>((b, p) => !b || p.losePts > b.losePts ? p : b, null);
		if (best) set('pepe', toEntry(best.loseRid, best.losePts.toFixed(2) + ' pts', `Week ${best.week}`), best.loseRid);
	}

	// 4. Chubby
	{
		const m = new Map<number, { sum: number; n: number }>();
		for (const p of pairs) { const c = m.get(p.winRid) ?? { sum: 0, n: 0 }; m.set(p.winRid, { sum: c.sum + p.margin, n: c.n + 1 }); }
		const best = [...m.entries()].reduce<{ rid: number; avg: number } | null>((b, [rid, { sum, n }]) => { const avg = sum / n; return !b || avg > b.avg ? { rid, avg } : b; }, null);
		if (best) set('chubby', toEntry(best.rid, `+${best.avg.toFixed(2)} avg margin`), best.rid);
	}

	// 5 (ricky_bobby). Don't you put that Evil on me, Ricky Bobby! — set manually via import page.

	// 6. Drive with Your Heart
	{
		const rosterPositions: string[] = league.roster_positions ?? [];
		const posCounts: Record<string, number> = {};
		const flexSlots: string[] = [];
		for (const pos of rosterPositions) {
			if (pos === 'BN' || pos === 'IR') continue;
			if (['FLEX', 'WRRB_FLEX', 'REC_FLEX', 'SUPER_FLEX'].includes(pos)) flexSlots.push(pos);
			else posCounts[pos] = (posCounts[pos] ?? 0) + 1;
		}

		if (rosterPositions.length > 0) {
			const m = new Map<number, { startedSum: number; maxSum: number }>();
			for (const s of weekScores) {
				if (s.players.length === 0) continue;
				const startedPts = s.starters.reduce((sum, pid) => sum + (s.playersPoints[pid] ?? 0), 0);
				const maxPts = computeOptimalScore(s, posCounts, flexSlots);
				if (maxPts > 0) {
					const c = m.get(s.rid) ?? { startedSum: 0, maxSum: 0 };
					m.set(s.rid, { startedSum: c.startedSum + startedPts, maxSum: c.maxSum + maxPts });
				}
			}
			const best = [...m.entries()].reduce<{ rid: number; eff: number } | null>(
				(b, [rid, { startedSum, maxSum }]) => {
					const eff = startedSum / maxSum;
					return !b || eff > b.eff ? { rid, eff } : b;
				},
				null,
			);
			if (best) set('drive_heart', toEntry(best.rid, (best.eff * 100).toFixed(2) + '%'), best.rid);
		}
	}

	// 7. Hakuna Matata, Bitches
	{
		const best = weekScores.reduce<WeekScore | null>((b, s) => !b || s.pts > b.pts ? s : b, null);
		if (best) set('hakuna', toEntry(best.rid, best.pts.toFixed(2) + ' pts', `Week ${best.week}`), best.rid);
	}

	// 8. Hard as a Diamond in an Ice Storm
	{
		const m = new Map<number, number>();
		for (const p of pairs) { m.set(p.winRid, (m.get(p.winRid) ?? 0) + p.losePts); m.set(p.loseRid, (m.get(p.loseRid) ?? 0) + p.winPts); }
		const best = [...m.entries()].reduce<{ rid: number; pts: number } | null>((b, [rid, pts]) => !b || pts > b.pts ? { rid, pts } : b, null);
		if (best) set('hard_diamond', toEntry(best.rid, best.pts.toFixed(1) + ' pts against'), best.rid);
	}

	// 9. I got it at Target
	{
		let best: { rosterId: number; playerId: string; pts: number; starts: number } | null = null;
		for (const [, add] of waiverAdds) {
			const entries = (starterIdx.get(`${add.playerId}_${add.rosterId}`) ?? []).filter(e => e.week >= add.week);
			const pts = entries.reduce((s, e) => s + e.pts, 0);
			if (pts > 0 && (!best || pts > best.pts)) best = { rosterId: add.rosterId, playerId: add.playerId, pts, starts: entries.length };
		}
		if (best) set('target', toEntry(best.rosterId, best.pts.toFixed(2) + ' pts', `${playersData[best.playerId]?.name ?? best.playerId} · ${best.starts} starts`), best.rosterId);
	}

	// 10. I Piss Excellence
	{
		const m = new Map<number, { sum: number; n: number }>();
		for (const s of weekScores) { if (s.pts > 0) { const c = m.get(s.rid) ?? { sum: 0, n: 0 }; m.set(s.rid, { sum: c.sum + s.pts, n: c.n + 1 }); } }
		const best = [...m.entries()].reduce<{ rid: number; avg: number } | null>((b, [rid, { sum, n }]) => { const avg = sum / n; return !b || avg > b.avg ? { rid, avg } : b; }, null);
		if (best) set('piss_excellence', toEntry(best.rid, best.avg.toFixed(2) + ' avg pts'), best.rid);
	}

	// 11. I'm on Fire!
	{
		let best: { rid: number; streak: number } | null = null;
		for (const r of rosters) {
			const streak = (r.metadata?.record ?? '').split('L').reduce((mx, s) => Math.max(mx, s.length), 0);
			if (!best || streak > best.streak) best = { rid: r.roster_id, streak };
		}
		if (best && best.streak > 0) set('on_fire', toEntry(best.rid, `${best.streak} straight wins`), best.rid);
	}

	// 12. Last Place
	{
		const r = rostersByRecord[rostersByRecord.length - 1];
		if (r) set('last_place', toEntry(r.roster_id, recordStr(r.settings.wins ?? 0, r.settings.losses ?? 0, r.settings.ties ?? 0)), r.roster_id);
	}

	// 13 + 14. Rookie Starts
	{
		const byRid = new Map<number, { starts: number; uniq: Set<string> }>();
		for (const s of weekScores) {
			for (const pid of s.starters) {
				if ((playersData[pid]?.yearsExp ?? -1) !== 0) continue;
				const c = byRid.get(s.rid) ?? { starts: 0, uniq: new Set<string>() };
				c.starts++; c.uniq.add(pid); byRid.set(s.rid, c);
			}
		}
		const bestUniq = [...byRid.entries()].reduce<{ rid: number; cnt: number } | null>((b, [rid, { uniq }]) => !b || uniq.size > b.cnt ? { rid, cnt: uniq.size } : b, null);
		if (bestUniq) set('18', toEntry(bestUniq.rid, `${bestUniq.cnt} unique rookies`), bestUniq.rid);
		const bestStarts = [...byRid.entries()].reduce<{ rid: number; starts: number; uniq: number } | null>((b, [rid, { starts, uniq }]) => !b || starts > b.starts ? { rid, starts, uniq: uniq.size } : b, null);
		if (bestStarts) set('ten_years_ii', toEntry(bestStarts.rid, `${bestStarts.starts} starts`, `${bestStarts.uniq} unique rookies`), bestStarts.rid);
	}

	// 15. See You When You're Grown
	{
		const r = rostersByRecord.slice(playoffTeamCount)[0];
		if (r) set('see_you_grown', toEntry(r.roster_id, recordStr(r.settings.wins ?? 0, r.settings.losses ?? 0, r.settings.ties ?? 0)), r.roster_id);
	}

	// 16. Spider Monkey
	{
		const m = new Map<number, number>();
		for (const s of weekScores) m.set(s.rid, (m.get(s.rid) ?? 0) + s.pts);
		const best = [...m.entries()].reduce<{ rid: number; pts: number } | null>((b, [rid, pts]) => !b || pts > b.pts ? { rid, pts } : b, null);
		if (best) set('spider_monkey', toEntry(best.rid, best.pts.toFixed(1) + ' total pts'), best.rid);
	}

	// 17. Magic Man
	{
		const m = new Map<number, { sum: number; n: number }>();
		for (const p of pairs) { const c = m.get(p.winRid) ?? { sum: 0, n: 0 }; m.set(p.winRid, { sum: c.sum + p.margin, n: c.n + 1 }); }
		const worst = [...m.entries()].reduce<{ rid: number; avg: number } | null>((b, [rid, { sum, n }]) => { const avg = sum / n; return !b || avg < b.avg ? { rid, avg } : b; }, null);
		if (worst) set('magic_man', toEntry(worst.rid, `+${worst.avg.toFixed(2)} avg margin`), worst.rid);
	}

	// 18. This is not Good
	{
		let best: { rid: number; streak: number } | null = null;
		for (const r of rosters) {
			const streak = (r.metadata?.record ?? '').split('W').reduce((mx, s) => Math.max(mx, s.length), 0);
			if (!best || streak > best.streak) best = { rid: r.roster_id, streak };
		}
		if (best && best.streak > 0) set('not_good', toEntry(best.rid, `${best.streak} straight losses`), best.rid);
	}

	// 19. Too Drunk to Taste This Chicken
	{
		const worst = pairs.reduce<Pair | null>((b, p) => !b || p.margin > b.margin ? p : b, null);
		if (worst) set('too_drunk', toEntry(worst.loseRid, `−${worst.margin.toFixed(2)} pts`, `Wk ${worst.week} vs ${rosterInfoMap.get(worst.winRid)?.teamName ?? `Team ${worst.winRid}`}`), worst.loseRid);
	}

	// 20. He was a Man
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
		const best = [...m.entries()].reduce<{ rid: number; avg: number } | null>((b, [rid, { sum, n }]) => { const avg = sum / n; return !b || avg > b.avg ? { rid, avg } : b; }, null);
		if (best) set('he_was_man', toEntry(best.rid, best.avg.toFixed(2) + ' avg yrs exp'), best.rid);
	}

	// 21. Break Us Like Wild Horses
	{
		const worst = weekScores.filter(s => s.pts > 0).reduce<WeekScore | null>((b, s) => !b || s.pts < b.pts ? s : b, null);
		if (worst) set('wild_horses', toEntry(worst.rid, worst.pts.toFixed(2) + ' pts', `Week ${worst.week}`), worst.rid);
	}

	// 22. Confused By Your Tactics
	{
		const nonWinners = rosters
			.filter(r => !winnerRids.has(r.roster_id))
			.sort((a, b) => combineFpts(b.settings.fpts ?? 0, b.settings.fpts_decimal ?? 0) - combineFpts(a.settings.fpts ?? 0, a.settings.fpts_decimal ?? 0));
		const r = nonWinners[0];
		if (r) {
			const pf = combineFpts(r.settings.fpts ?? 0, r.settings.fpts_decimal ?? 0);
			set('confused', toEntry(r.roster_id, pf.toFixed(1) + ' pts for', recordStr(r.settings.wins ?? 0, r.settings.losses ?? 0, r.settings.ties ?? 0)));
		}
	}

	return result;
}
