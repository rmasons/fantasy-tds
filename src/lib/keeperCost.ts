/**
 * Pure keeper cost calculations — no DB, no network.
 *
 * These functions mirror the formulas in src/lib/server/keepers.ts exactly.
 * They are extracted here so the scenario builder (and tests) can price
 * hypothetical keeper sets purely on the client, with data already loaded.
 */

/** Draft round → base FAAB cost. R1=$75, R2=$70, … floor at $5. */
export function roundToBaseCost(round: number): number {
	return Math.max(5, 80 - 5 * round);
}

/**
 * Apply years-kept escalation to a base cost.
 * Formula: ceil(effective × (1 + 0.20 × (yearsKept + 1)))
 * where effective = max(5, baseCost) to floor sub-$1 values.
 */
export function calcKeeperCost(baseCost: number, yearsKept: number): number {
	const effective = baseCost < 1 ? 5 : baseCost;
	return Math.ceil(effective * (1 + 0.2 * (yearsKept + 1)));
}

/** One player's contribution to a scenario. */
export interface ScenarioPlayer {
	playerId: string;
	keeperCost: number;
}

/** Summary totals for a hypothetical keeper set. */
export interface ScenarioResult {
	count: number;
	totalCost: number;
	/** FAAB remaining after deducting keeper costs. null if faabRemaining is unknown. */
	faabAfter: number | null;
	/** True when maxKeepers > 0 and count exceeds the limit. */
	overLimit: boolean;
}

/**
 * Price a set of player IDs against the pre-priced player list.
 * Players not found in the list are silently skipped (they're off-roster).
 */
export function computeScenario(
	selectedIds: Set<string>,
	allPlayers: ScenarioPlayer[],
	faabRemaining: number | null,
	maxKeepers: number,
): ScenarioResult {
	const kept = allPlayers.filter(p => selectedIds.has(p.playerId));
	const totalCost = kept.reduce((s, p) => s + p.keeperCost, 0);
	return {
		count: kept.length,
		totalCost,
		faabAfter: faabRemaining !== null ? faabRemaining - totalCost : null,
		overLimit: maxKeepers > 0 && kept.length > maxKeepers,
	};
}
