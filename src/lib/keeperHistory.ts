/**
 * Pure keeper-history resolution — no DB, no network.
 *
 * Turns a league's per-season draft record into the two inputs the pricing
 * formulas need: how many seasons a player has *actually* been kept, and the
 * draft pick that anchors their base cost.
 *
 * Why this is not just "planningYear − draftSeason":
 *
 *   Sleeper marks a keeper pick with `is_keeper: true`. That flag is the only
 *   hard evidence of a keeper year. Inferring keeper years from the gap between
 *   an old draft pick and the planning year is wrong in both directions:
 *
 *     • A player picked up off waivers and then kept has no ordinary draft pick
 *       at all, so the gap-based guess reports him as never kept.
 *     • A player drafted years ago, dropped, and later re-added off waivers has
 *       an old draft pick, so the gap-based guess reports him as kept ever since.
 *
 *   Counting `is_keeper` picks backwards from the planning year gets both right.
 */

/** One player's pick in one season's draft. */
export interface DraftPickRecord {
	round: number;
	/** True when Sleeper flagged the pick as a keeper carry-over. */
	isKeeper: boolean;
	/** Roster that made/held the pick. Null when Sleeper omitted it. */
	rosterId: number | null;
}

/** season ("2025") → playerId → pick. */
export type DraftHistory = Record<string, Record<string, DraftPickRecord>>;

/** What the keeper walk-back concluded about one player. */
export interface KeeperHistory {
	/**
	 * Seasons this player has already been kept, counting back from the
	 * planning year. 0 means "on the roster but never kept" — keeping them for
	 * the planning year would be their first keeper season.
	 */
	yearsKept: number;
	/** Round of the draft pick that anchors base cost. Null when undrafted. */
	draftRound: number | null;
	/** Season of that anchoring pick. Null when undrafted. */
	draftSeason: string | null;
	/**
	 * Season the player was acquired — the season immediately before their
	 * keeper streak began. Set even when they were undrafted (waiver/FA add),
	 * as long as that season is covered by the league's draft history.
	 */
	acquiredSeason: string | null;
}

/**
 * Walk a player's keeper streak backwards from the planning year.
 *
 * Starts at `planningYear - 1` (the planning year's own draft has not happened
 * yet, or is irrelevant — keepers are being chosen *for* it) and counts
 * consecutive seasons in which the player appears as a keeper pick. The first
 * season that breaks the streak is their acquisition season: an ordinary draft
 * pick there sets the base cost, and its absence means they were added off
 * waivers/FA and price at the league floor.
 */
export function resolveKeeperHistory(
	history: DraftHistory,
	playerId: string,
	planningYear: number,
): KeeperHistory {
	let yearsKept = 0;
	let season = planningYear - 1;

	// Count back while the player was flagged as a keeper. A season missing from
	// the history (league lineage ends, or that draft failed to load) also stops
	// the walk, so this always terminates.
	while (true) {
		const rec = history[String(season)]?.[playerId];
		if (!rec || !rec.isKeeper) break;
		yearsKept++;
		season--;
	}

	// `season` is now the acquisition season — the year the current streak began.
	const seasonKey = String(season);
	const anchor = history[seasonKey]?.[playerId];
	const seasonCovered = history[seasonKey] !== undefined;

	return {
		yearsKept,
		draftRound: anchor && !anchor.isKeeper ? anchor.round : null,
		draftSeason: anchor && !anchor.isKeeper ? seasonKey : null,
		acquiredSeason: seasonCovered ? seasonKey : null,
	};
}
