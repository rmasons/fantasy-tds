/**
 * rivalryDigest.ts — pure logic for computing "this week's grudge match" digest.
 *
 * Given this week's scheduled pairings and each pair's H2H record (already
 * fetched from rivalry.ts), produces a ranked list of digest items with a
 * headline and supporting stat. Kept pure so it's unit-testable without
 * any network or Firebase access.
 */

import type { H2HMatchup, RivalryResult, ManagerOption } from '$lib/server/rivalry';

// ── Public types ──────────────────────────────────────────────────────────────

/** A single scheduled matchup this week, keyed by Sleeper user IDs. */
export interface WeeklyPairing {
	managerOneId: string;
	managerTwoId: string;
}

/** A ranked digest item surfacing the most interesting aspects of a matchup. */
export interface DigestItem {
	/** The two managers in this matchup. */
	managerOne: ManagerOption;
	managerTwo: ManagerOption;
	/** Short, punchy headline — e.g. "All-time series tied 5–5". */
	headline: string;
	/** Secondary supporting stat — e.g. "Loser drops below .500" or "Revenge game". */
	subline: string;
	/** Numeric score used to rank items (higher = more compelling). */
	interestScore: number;
	/** Which signal(s) drove this item's ranking. */
	signals: DigestSignal[];
}

export type DigestSignal =
	| 'first_meeting'
	| 'tied_series'
	| 'revenge_game'
	| 'streak_on_the_line'
	| 'lopsided_series'
	| 'close_series'
	| 'high_scoring_rivalry'
	| 'rivalry_points_edge';

// ── Signal scoring weights ────────────────────────────────────────────────────

const SIGNAL_SCORES: Record<DigestSignal, number> = {
	tied_series:          10,
	revenge_game:          9,
	streak_on_the_line:    8,
	first_meeting:         7,
	close_series:          6,
	lopsided_series:       4,
	high_scoring_rivalry:  3,
	rivalry_points_edge:   2,
};

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Compute the win streak for manager "one" from the most-recent matchups.
 *  Positive = consecutive wins by one, negative = losses (wins for two).
 *  Returns 0 for a tie at the head of the list. */
function computeStreak(matchups: H2HMatchup[]): { count: number; winner: 'one' | 'two' | null } {
	if (matchups.length === 0) return { count: 0, winner: null };
	const first = matchups[0];
	const leader: 'one' | 'two' | null =
		first.teamOne.points > first.teamTwo.points ? 'one' :
		first.teamTwo.points > first.teamOne.points ? 'two' : null;

	if (!leader) return { count: 1, winner: null };

	let count = 0;
	for (const m of matchups) {
		const w = m.teamOne.points > m.teamTwo.points ? 'one' :
		          m.teamTwo.points > m.teamOne.points ? 'two' : null;
		if (w === leader) count++;
		else break;
	}
	return { count, winner: leader };
}

/** The most recent matchup between the two managers (index 0 = latest). */
function lastMatchup(matchups: H2HMatchup[]): H2HMatchup | null {
	return matchups.length > 0 ? matchups[0] : null;
}

// ── Core digest-item builder ──────────────────────────────────────────────────

/**
 * Build a single DigestItem for one weekly pairing + its H2H history.
 * Returns null only if both managers can't be found in the options list.
 */
export function buildDigestItem(
	pairing: WeeklyPairing,
	record: RivalryResult,
	managerOptions: ManagerOption[],
): DigestItem | null {
	const one = managerOptions.find((m) => m.userId === pairing.managerOneId);
	const two = managerOptions.find((m) => m.userId === pairing.managerTwoId);
	if (!one || !two) return null;

	const totalMatchups = record.wins.one + record.wins.two + record.ties;
	const signals: DigestSignal[] = [];
	let headline = '';
	let subline = '';

	// ── Signal detection ──────────────────────────────────────────────────────

	if (totalMatchups === 0) {
		// First-ever meeting
		signals.push('first_meeting');
		headline = 'First-ever meeting';
		subline = `${one.teamName} vs ${two.teamName} — no history yet`;

	} else {
		// Tied series
		if (record.wins.one === record.wins.two && record.ties === 0) {
			signals.push('tied_series');
			headline = `All-time series tied ${record.wins.one}–${record.wins.two}`;
			subline = 'Winner takes the head-to-head lead';
		}

		// Revenge game: loser of last meeting
		const last = lastMatchup(record.matchups);
		if (last) {
			const lastWinner: 'one' | 'two' | null =
				last.teamOne.points > last.teamTwo.points ? 'one' :
				last.teamTwo.points > last.teamOne.points ? 'two' : null;
			if (lastWinner) {
				const loserName = lastWinner === 'one' ? two.teamName : one.teamName;
				const margin = Math.abs(last.teamOne.points - last.teamTwo.points).toFixed(2);
				signals.push('revenge_game');
				if (!headline) {
					headline = `Revenge game for ${loserName}`;
					subline = `Lost by ${margin} pts in their last meeting (${last.season} Wk ${last.week})`;
				} else {
					subline += ` · ${loserName} seeking revenge (lost by ${margin})`;
				}
			}
		}

		// Streak on the line (≥3 consecutive)
		const streak = computeStreak(record.matchups);
		if (streak.winner && streak.count >= 3) {
			signals.push('streak_on_the_line');
			const streakHolder = streak.winner === 'one' ? one.teamName : two.teamName;
			const defender = streak.winner === 'one' ? two.teamName : one.teamName;
			if (!headline) {
				headline = `${streakHolder} riding a ${streak.count}-game win streak`;
				subline = `${defender} tries to end the run`;
			} else {
				subline += ` · ${streakHolder} on a ${streak.count}-game streak`;
			}
		}

		// Lopsided series (≥60% win rate for one side, ≥5 games)
		if (totalMatchups >= 5) {
			const winRateOne = record.wins.one / totalMatchups;
			const winRateTwo = record.wins.two / totalMatchups;
			const dominant = winRateOne >= 0.6 ? 'one' : winRateTwo >= 0.6 ? 'two' : null;
			if (dominant) {
				signals.push('lopsided_series');
				const domName = dominant === 'one' ? one.teamName : two.teamName;
				const domWins = dominant === 'one' ? record.wins.one : record.wins.two;
				const domLosses = totalMatchups - domWins - record.ties;
				const domRecord = `${domWins}–${domLosses}${record.ties > 0 ? `–${record.ties}` : ''}`;
				if (!headline) {
					headline = `${domName} dominates ${domRecord} all-time`;
					subline = `${(Math.max(winRateOne, winRateTwo) * 100).toFixed(0)}% win rate`;
				}
			} else if (totalMatchups >= 5) {
				// Close series (within 1 game)
				const gap = Math.abs(record.wins.one - record.wins.two);
				if (gap <= 1) {
					signals.push('close_series');
					if (!headline) {
						const r = `${record.wins.one}–${record.wins.two}${record.ties > 0 ? `–${record.ties}` : ''}`;
						headline = `Deadlocked all-time series (${r})`;
						subline = 'Too close to call';
					}
				}
			}
		}

		// High-scoring rivalry (avg combined ≥ 240 pts/game)
		if (totalMatchups > 0) {
			const avgCombined = (record.points.one + record.points.two) / totalMatchups;
			if (avgCombined >= 240) {
				signals.push('high_scoring_rivalry');
				if (!subline) {
					subline = `High-scoring rivalry — avg ${avgCombined.toFixed(1)} combined pts/game`;
				}
			}

			// Points edge — one manager averages noticeably more
			const avgOne = record.points.one / totalMatchups;
			const avgTwo = record.points.two / totalMatchups;
			const ptGap = Math.abs(avgOne - avgTwo);
			if (ptGap >= 10) {
				signals.push('rivalry_points_edge');
				const edgeName = avgOne > avgTwo ? one.teamName : two.teamName;
				if (!subline) {
					subline = `${edgeName} averages +${ptGap.toFixed(1)} pts/game in this rivalry`;
				}
			}
		}

		// If we still have no headline, build a generic one from the record
		if (!headline) {
			const r = `${record.wins.one}–${record.wins.two}${record.ties > 0 ? `–${record.ties}` : ''}`;
			headline = `Series: ${one.teamName} leads ${r}`;
			if (!subline) {
				subline = `${totalMatchups} all-time matchup${totalMatchups !== 1 ? 's' : ''}`;
			}
		}
	}

	// ── Interest score ────────────────────────────────────────────────────────
	const interestScore = signals.reduce((acc, s) => acc + SIGNAL_SCORES[s], 0);

	return { managerOne: one, managerTwo: two, headline, subline, interestScore, signals };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Given all weekly pairings and their H2H records, produce a ranked list
 * of digest items from most to least compelling.
 *
 * @param pairings     This week's scheduled matchups (managerOneId / managerTwoId).
 * @param records      Map of `${minId}_${maxId}` → RivalryResult, pre-fetched.
 * @param managerOptions  All managers in the league for name/avatar lookup.
 */
export function computeRivalryDigest(
	pairings: WeeklyPairing[],
	records: Map<string, RivalryResult>,
	managerOptions: ManagerOption[],
): DigestItem[] {
	const items: DigestItem[] = [];

	for (const pairing of pairings) {
		// Canonical key: sort IDs so lookup is order-independent
		const key = [pairing.managerOneId, pairing.managerTwoId].sort().join('_');
		const record = records.get(key) ?? {
			wins: { one: 0, two: 0 },
			ties: 0,
			points: { one: 0, two: 0 },
			matchups: [],
		};

		const item = buildDigestItem(pairing, record, managerOptions);
		if (item) items.push(item);
	}

	// Sort by interestScore descending, then alphabetically for stability
	return items.sort((a, b) =>
		b.interestScore - a.interestScore ||
		a.managerOne.teamName.localeCompare(b.managerOne.teamName)
	);
}
