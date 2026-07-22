/**
 * Pure Promotion Points calculations — no DB, no network, no Date.now.
 *
 * Implements the award table in docs/PREMIER_KEEPERS.md §III: per-week
 * head-to-head + league-median + tier-median deltas, the neglect-escalation
 * formula, and the Week 17 play-in / automatic-relegation projection.
 *
 * Everything here takes already-fetched data (weekly roster scores, a tier
 * map) and returns numbers. `src/lib/server/promotionPoints.ts` is the only
 * place that talks to Sleeper or Firestore.
 */

export type Tier = 1 | 2 | 3;
export type TierMap = Record<number, Tier>;

// ── Median ───────────────────────────────────────────────────────────────────

/**
 * Median of a list of numbers. Even-length lists average the two middle
 * values (standard definition). This is why an exact median *tie* is a real,
 * regularly-occurring case for the 12-team league median (avg of the 6th and
 * 7th scores) but rarer for the 4-team tier median (avg of the 2nd and 3rd) —
 * both are handled identically per the commissioner's tie ruling below.
 */
export function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ── Weekly matchup shaping ───────────────────────────────────────────────────

/** One roster's raw score in one week, as read off a Sleeper matchup week. */
export interface RawWeekMatchup {
	rosterId: number;
	matchupId: number;
	points: number;
}

/** A roster's score for a week, paired with its head-to-head opponent. */
export interface WeekRosterScore {
	week: number;
	rosterId: number;
	points: number;
	opponentRosterId: number;
	opponentPoints: number;
}

/**
 * Pair up a week's raw matchups by matchupId into (roster, opponent) rows.
 * Groups that aren't exactly 2 rosters (byes, data glitches) are dropped —
 * there's no well-defined opponent to score h2h against.
 */
export function pairWeekMatchups(week: number, raw: RawWeekMatchup[]): WeekRosterScore[] {
	const byMatchup = new Map<number, RawWeekMatchup[]>();
	for (const m of raw) {
		const list = byMatchup.get(m.matchupId);
		if (list) list.push(m);
		else byMatchup.set(m.matchupId, [m]);
	}

	const rows: WeekRosterScore[] = [];
	for (const pair of byMatchup.values()) {
		if (pair.length !== 2) continue;
		const [a, b] = pair;
		rows.push({ week, rosterId: a.rosterId, points: a.points, opponentRosterId: b.rosterId, opponentPoints: b.points });
		rows.push({ week, rosterId: b.rosterId, points: b.points, opponentRosterId: a.rosterId, opponentPoints: a.points });
	}
	return rows;
}

// ── Award table ──────────────────────────────────────────────────────────────

/** Win PP by the *opponent's* tier — independent of your own tier. */
const WIN_PP_BY_OPPONENT_TIER: Record<Tier, number> = { 1: 3, 2: 2, 3: 1 };

/**
 * Loss PP vs a head-to-head opponent.
 * Same tier: -1. Opponent is a *lower* tier (worse, higher tier number):
 * -2 (losing down is bad). Opponent is a *higher* tier (better, lower tier
 * number): 0 (commissioner ruling — losing up is expected).
 */
function lossPPByOpponentTier(yourTier: Tier, opponentTier: Tier): number {
	if (opponentTier === yourTier) return -1;
	if (opponentTier > yourTier) return -2; // opponent is a worse tier
	return 0; // opponent is a better tier
}

/**
 * Commissioner ruling: every tie — head-to-head, league median, or tier
 * median — awards exactly 0 PP on both sides. No win credit, no loss penalty.
 */
const TIE_PP = 0;

/** Itemized PP for one roster in one week. */
export interface PPBreakdown {
	week: number;
	rosterId: number;
	tier: Tier;
	points: number;
	opponentRosterId: number;
	opponentTier: Tier;
	h2h: number;
	leagueMedian: number;
	tierMedian: number;
	total: number;
}

/**
 * Compute PP for a single week across all rosters.
 * `weekRows` must already be paired by `pairWeekMatchups` (one row per
 * roster with its opponent for that week). `tierMap` must cover every
 * rosterId present or that roster is silently skipped (no snapshot ⇒
 * nothing we can score).
 */
export function computeWeekPP(weekRows: WeekRosterScore[], tierMap: TierMap): PPBreakdown[] {
	const scored = weekRows.filter((r) => tierMap[r.rosterId] !== undefined && tierMap[r.opponentRosterId] !== undefined);
	if (scored.length === 0) return [];

	const leagueMed = median(scored.map((r) => r.points));

	const byTier = new Map<Tier, number[]>();
	for (const r of scored) {
		const t = tierMap[r.rosterId];
		const list = byTier.get(t);
		if (list) list.push(r.points);
		else byTier.set(t, [r.points]);
	}
	const tierMedByTier = new Map<Tier, number>();
	for (const [t, pts] of byTier) tierMedByTier.set(t, median(pts));

	return scored.map((r) => {
		const tier = tierMap[r.rosterId];
		const opponentTier = tierMap[r.opponentRosterId];

		// h2h — tie, win, or loss against the paired opponent
		let h2h: number;
		if (r.points === r.opponentPoints) {
			h2h = TIE_PP;
		} else if (r.points > r.opponentPoints) {
			h2h = WIN_PP_BY_OPPONENT_TIER[opponentTier];
		} else {
			h2h = lossPPByOpponentTier(tier, opponentTier);
		}

		// league median — win/loss/tie vs the median of all scored rosters this week
		const leagueMedian = r.points === leagueMed ? TIE_PP : r.points > leagueMed ? 1 : -1;

		// tier median — win/loss/tie vs the median of just this roster's tier
		const tierMed = tierMedByTier.get(tier)!;
		const tierMedian = r.points === tierMed ? TIE_PP : r.points > tierMed ? 2 : -1;

		return {
			week: r.week,
			rosterId: r.rosterId,
			tier,
			points: r.points,
			opponentRosterId: r.opponentRosterId,
			opponentTier,
			h2h,
			leagueMedian,
			tierMedian,
			total: h2h + leagueMedian + tierMedian,
		};
	});
}

/** One week of raw matchups, ready to feed into the season walk. */
export interface WeekMatchups {
	week: number;
	matchups: RawWeekMatchup[];
}

/**
 * Walk every regular-season week (whatever weeks are passed — the caller is
 * responsible for restricting to Weeks 1–14, since medians and PP only
 * accrue during the regular season) and return the full itemized breakdown,
 * sorted by week then rosterId.
 */
export function computeSeasonPP(weeks: WeekMatchups[], tierMap: TierMap): PPBreakdown[] {
	const out: PPBreakdown[] = [];
	for (const { week, matchups } of weeks) {
		out.push(...computeWeekPP(pairWeekMatchups(week, matchups), tierMap));
	}
	return out.sort((a, b) => a.week - b.week || a.rosterId - b.rosterId);
}

/** Sum a roster's weekly PP breakdowns into a single season total. */
export function sumSeasonPP(breakdown: PPBreakdown[], rosterId: number): number {
	return breakdown.filter((b) => b.rosterId === rosterId).reduce((s, b) => s + b.total, 0);
}

// ── Roster neglect escalation ────────────────────────────────────────────────

/** Escalating neglect penalty: -1 / -3 / -5 / -10 for 1st / 2nd / 3rd / subsequent. */
export function deriveNeglectAmount(priorNeglectCount: number): number {
	if (priorNeglectCount <= 0) return -1;
	if (priorNeglectCount === 1) return -3;
	if (priorNeglectCount === 2) return -5;
	return -10;
}

// ── Promotion / relegation projection (§III) ────────────────────────────────

/** A roster's season-end (or in-progress) standing within its tier. */
export interface TierRoster {
	rosterId: number;
	tier: Tier;
	totalPP: number;
	pointsFor: number; // tiebreaker
}

/** Rank a tier's rosters best-to-worst: PP desc, Points For as tiebreaker. */
export function rankTier(rosters: TierRoster[]): TierRoster[] {
	return [...rosters].sort((a, b) => b.totalPP - a.totalPP || b.pointsFor - a.pointsFor);
}

/**
 * One Week-17 play-in matchup: the lower tier's challenger (top 2) against
 * the upper tier's incumbent (bottom 2). Seeded best-challenger-vs-worst-
 * incumbent: challenger #1 draws the upper tier's last place, challenger #2
 * draws the upper tier's 3rd place.
 */
export interface PlayInMatchup {
	upperTier: Tier;
	lowerTier: Tier;
	challengerSeed: 1 | 2;
	challenger: TierRoster;
	/** Seed within the upper tier, i.e. its finishing rank (3rd or 4th/last). */
	incumbentSeed: 3 | 4;
	incumbent: TierRoster;
	/** Winner's rosterId once Week 17 is played; null while still projected/TBD. */
	winnerRosterId: number | null;
}

/**
 * Build the two play-in brackets (Tier II challenging Tier I, Tier III
 * challenging Tier II) from end-of-(or in-progress-)season standings.
 *
 * `week17Points` is optional: when Week 17 has actually been played, pass a
 * rosterId → points map so the winner can be resolved directly from the real
 * score (higher score wins; a tie defends the incumbent's spot — ties don't
 * "win" a promotion any more than they win PP). Omit it (or leave a roster's
 * points out of the map) to get a `winnerRosterId: null` — a projected
 * pairing with no decided outcome yet.
 */
export function buildPlayInMatchups(standings: TierRoster[], week17Points?: Map<number, number>): PlayInMatchup[] {
	const byTier = new Map<Tier, TierRoster[]>();
	for (const t of [1, 2, 3] as Tier[]) {
		byTier.set(t, rankTier(standings.filter((r) => r.tier === t)));
	}

	function winnerOf(challenger: TierRoster, incumbent: TierRoster): number | null {
		if (!week17Points) return null;
		const cPts = week17Points.get(challenger.rosterId);
		const iPts = week17Points.get(incumbent.rosterId);
		if (cPts === undefined || iPts === undefined) return null;
		if (cPts === iPts) return incumbent.rosterId; // tie defends the incumbent's tier
		return cPts > iPts ? challenger.rosterId : incumbent.rosterId;
	}

	function bracket(upperTier: Tier, lowerTier: Tier): PlayInMatchup[] {
		const upper = byTier.get(upperTier) ?? [];
		const lower = byTier.get(lowerTier) ?? [];
		if (upper.length < 4 || lower.length < 2) return [];

		const challengers = lower.slice(0, 2); // top 2 of the lower tier
		const incumbents = upper.slice(-2); // bottom 2 of the upper tier: [3rd, 4th/last]

		const pairs: Array<[TierRoster, TierRoster, 1 | 2, 3 | 4]> = [
			[challengers[0], incumbents[1], 1, 4], // best challenger vs worst incumbent
			[challengers[1], incumbents[0], 2, 3], // 2nd challenger vs 3rd-place incumbent
		];

		return pairs.map(([challenger, incumbent, challengerSeed, incumbentSeed]) => ({
			upperTier,
			lowerTier,
			challengerSeed,
			challenger,
			incumbentSeed,
			incumbent,
			winnerRosterId: winnerOf(challenger, incumbent),
		}));
	}

	return [...bracket(1, 2), ...bracket(2, 3)];
}

export type MovementReason =
	| 'play-in-promotion'
	| 'play-in-relegation'
	| 'auto-relegation'
	| 'auto-promotion'
	| 'sub-zero-floor' // Tier III, below 0 PP, no tier below to drop to — warning only
	| 'stay';

/** Where a roster ends up next season, and why. */
export interface Movement {
	rosterId: number;
	fromTier: Tier;
	toTier: Tier;
	reason: MovementReason;
}

/**
 * Resolve full promotion/relegation movement from standings + play-in
 * results, per §III:
 *
 * 1. Decided play-ins move their participants (challenger up on a win,
 *    incumbent down on a loss/tie). Undecided play-ins (winnerRosterId null)
 *    move nobody yet — they're still projections.
 * 2. Any roster finishing below 0 PP drops a tier, UNLESS it was already
 *    moved by a decided play-in this cycle (it already has a resolved
 *    destination). It's replaced by the highest-PP roster in the tier below,
 *    skipping any candidate already relegated via a lost play-in (that
 *    candidate is already leaving its tier for a different reason) or
 *    already claimed as another sub-zero slot's replacement this cycle.
 * 3. Tier III has no tier below it — a sub-zero Tier III finish is a warning
 *    (`sub-zero-floor`), not an actual relegation.
 */
export function resolveTierMovements(standings: TierRoster[], playIns: PlayInMatchup[]): Movement[] {
	const movements = new Map<number, Movement>();
	for (const r of standings) {
		movements.set(r.rosterId, { rosterId: r.rosterId, fromTier: r.tier, toTier: r.tier, reason: 'stay' });
	}

	// 1. Decided play-ins.
	for (const pi of playIns) {
		if (pi.winnerRosterId === null) continue;
		if (pi.winnerRosterId === pi.challenger.rosterId) {
			movements.set(pi.challenger.rosterId, {
				rosterId: pi.challenger.rosterId,
				fromTier: pi.lowerTier,
				toTier: pi.upperTier,
				reason: 'play-in-promotion',
			});
			movements.set(pi.incumbent.rosterId, {
				rosterId: pi.incumbent.rosterId,
				fromTier: pi.upperTier,
				toTier: pi.lowerTier,
				reason: 'play-in-relegation',
			});
		}
		// Incumbent win (or tie, which defends): both stay — leave default 'stay' entries.
	}

	const alreadyMoved = (rosterId: number) => movements.get(rosterId)!.reason !== 'stay';

	// 2/3. Automatic relegation for sub-zero finishes, tier by tier (I then II —
	// Tier III has no tier below it to source a replacement from).
	const claimedReplacements = new Set<number>();
	for (const tier of [1, 2] as Tier[]) {
		const belowTier = (tier + 1) as Tier;
		const subZero = standings.filter((r) => r.tier === tier && r.totalPP < 0 && !alreadyMoved(r.rosterId));

		const candidatePool = rankTier(standings.filter((r) => r.tier === belowTier)).filter(
			(r) => !alreadyMoved(r.rosterId) && !claimedReplacements.has(r.rosterId),
		);

		for (const dropped of subZero) {
			const replacement = candidatePool.shift();
			movements.set(dropped.rosterId, {
				rosterId: dropped.rosterId,
				fromTier: tier,
				toTier: belowTier,
				reason: 'auto-relegation',
			});
			if (replacement) {
				claimedReplacements.add(replacement.rosterId);
				movements.set(replacement.rosterId, {
					rosterId: replacement.rosterId,
					fromTier: belowTier,
					toTier: tier,
					reason: 'auto-promotion',
				});
			}
			// If the pool is exhausted there's nobody left to promote up — the
			// relegation still stands, it's just unmatched this cycle.
		}
	}

	// Tier III sub-zero finishes: nowhere to drop, flag as a warning only.
	for (const r of standings.filter((r) => r.tier === 3 && r.totalPP < 0 && !alreadyMoved(r.rosterId))) {
		movements.set(r.rosterId, { rosterId: r.rosterId, fromTier: 3, toTier: 3, reason: 'sub-zero-floor' });
	}

	return [...movements.values()];
}
