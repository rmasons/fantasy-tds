import { cachedFetch, cacheKey, deleteCache } from '$lib/server/cache';
import { getCachedMatchups } from '$lib/server/sleeperCache';
import { fetchLeagueCore, fetchMatchups } from '$lib/sleeper';
import { getLeagueConfig, leagueConfigKey, type LeagueConfig, type PremierConfig, type PromotionTransaction, type TierBudget } from '$lib/server/config';
import { adminDb } from '$lib/firebase/admin';
import {
	computeSeasonPP,
	sumSeasonPP,
	deriveNeglectAmount,
	buildPlayInMatchups,
	resolveTierMovements,
	type Tier,
	type TierMap,
	type PPBreakdown,
	type TierRoster,
	type PlayInMatchup,
	type Movement,
	type RawWeekMatchup,
} from '$lib/promotionPoints';

// §I defaults from docs/PREMIER_KEEPERS.md. Used whenever a league turns the
// premier ruleset on and hasn't set its own values yet.
export const DEFAULT_AUCTION_BUDGET: TierBudget = { 1: 300, 2: 200, 3: 100 };
export const DEFAULT_FAAB_BUDGET: TierBudget = { 1: 300, 2: 200, 3: 100 };
export const DEFAULT_TRADE_BUDGET_CAP: TierBudget = { 1: 200, 2: 100, 3: 100 };
export const DEFAULT_REGULAR_SEASON_END_WEEK = 14;
/**
 * Hard bound on the PP walk. regularSeasonEndWeek directly sizes a concurrent
 * Sleeper request fan-out (one per week), so an admin typo must not be able to
 * turn a page load into hundreds of outbound requests. 18 is the NFL regular
 * season's maximum.
 */
export const MAX_REGULAR_SEASON_END_WEEK = 18;

/** Clamp a user-supplied week count into [1, MAX_REGULAR_SEASON_END_WEEK]. */
export function clampRegularSeasonEndWeek(week: number): number {
	if (!Number.isFinite(week)) return DEFAULT_REGULAR_SEASON_END_WEEK;
	return Math.min(MAX_REGULAR_SEASON_END_WEEK, Math.max(1, Math.floor(week)));
}
// Week 17 (championship week 2) per the commissioner's ruling on the play-in week.
export const PLAY_IN_WEEK = 17;

function withPremierDefaults(cfg: LeagueConfig): PremierConfig {
	const p = cfg.premier;
	return {
		tiersBySeason: p?.tiersBySeason ?? {},
		auctionBudget: p?.auctionBudget ?? DEFAULT_AUCTION_BUDGET,
		faabBudget: p?.faabBudget ?? DEFAULT_FAAB_BUDGET,
		tradeBudgetCap: p?.tradeBudgetCap ?? DEFAULT_TRADE_BUDGET_CAP,
		// Clamped on read as well as on write: a value persisted before the bound
		// existed must not be able to fan out unbounded requests.
		regularSeasonEndWeek: clampRegularSeasonEndWeek(p?.regularSeasonEndWeek ?? DEFAULT_REGULAR_SEASON_END_WEEK),
		promotionTransactions: p?.promotionTransactions ?? [],
		promotionAdjustments: p?.promotionAdjustments ?? {},
	};
}

// ── Ledger (mirrors src/lib/server/faab.ts exactly) ─────────────────────────

/** Sum each roster's adjustments into the net map consumers read. */
export function netFromPromotionLedger(txns: PromotionTransaction[]): Record<string, number> {
	const net: Record<string, number> = {};
	for (const t of txns) net[t.rosterId] = (net[t.rosterId] ?? 0) + t.amount;
	for (const k of Object.keys(net)) if (net[k] === 0) delete net[k];
	return net;
}

/** Newest-first ledger for display. */
export function sortPromotionLedger(txns: PromotionTransaction[]): PromotionTransaction[] {
	return [...txns].sort((a, b) => b.createdAt - a.createdAt);
}

/** Count a roster's prior 'neglect' entries in a season — drives the escalation amount. */
export function countPriorNeglect(txns: PromotionTransaction[], rosterId: string, season: string): number {
	return txns.filter((t) => t.kind === 'neglect' && t.rosterId === rosterId && t.season === season).length;
}

/** Read the league's full PP ledger (newest first), across all seasons. */
export async function getPromotionLedger(leagueId: string): Promise<PromotionTransaction[]> {
	const config = await getLeagueConfig(leagueId);
	return sortPromotionLedger(config.premier?.promotionTransactions ?? []);
}

/**
 * Atomically mutate the whole premier config block inside a Firestore
 * transaction (same read-modify-write-race protection as faab.ts's
 * mutateLedger). The mutate callback receives the current block *read from
 * within the transaction*, never from the 5-minute leagueConfig cache — so
 * derived values (neglect escalation) are computed against a consistent
 * snapshot, and a concurrent writer can't be silently reverted by a stale
 * read. Every premier write goes through here for that reason; using
 * getLeagueConfig + setLeagueConfig instead would reintroduce the clobber.
 */
async function mutatePremierConfig(
	leagueId: string,
	mutate: (premier: PremierConfig) => PremierConfig,
): Promise<void> {
	const ref = adminDb().collection('leagueConfig').doc(leagueId);
	await adminDb().runTransaction(async (tx) => {
		const snap = await tx.get(ref);
		const config = (snap.exists ? snap.data() : {}) as LeagueConfig;
		tx.set(ref, { premier: mutate(withPremierDefaults(config)) }, { merge: true });
	});
	await deleteCache(leagueConfigKey(leagueId));
}

/** Ledger mutation on top of mutatePremierConfig, keeping the net map in sync. */
async function mutatePromotionLedger(
	leagueId: string,
	mutate: (ledger: PromotionTransaction[]) => PromotionTransaction[],
): Promise<void> {
	await mutatePremierConfig(leagueId, (premier) => {
		const next = mutate(premier.promotionTransactions);
		return { ...premier, promotionTransactions: next, promotionAdjustments: netFromPromotionLedger(next) };
	});
}

export async function addPromotionTransaction(
	leagueId: string,
	entry: { rosterId: string; season: string; kind: PromotionTransaction['kind']; amount?: number; reason: string; createdBy: string },
): Promise<PromotionTransaction> {
	let created: PromotionTransaction | null = null;
	await mutatePromotionLedger(leagueId, (ledger) => {
		// Collusion is a fixed -5. Neglect is derived from prior offenses this
		// season — the admin never enters a number for it. 'other' is a free
		// manual amount for anything else the commissioner needs to record.
		const amount =
			entry.kind === 'collusion'
				? -5
				: entry.kind === 'neglect'
					? deriveNeglectAmount(countPriorNeglect(ledger, entry.rosterId, entry.season))
					: (entry.amount ?? 0);

		const txn: PromotionTransaction = {
			id: crypto.randomUUID(),
			rosterId: entry.rosterId,
			season: entry.season,
			amount,
			reason: entry.reason,
			kind: entry.kind,
			createdAt: Date.now(),
			createdBy: entry.createdBy,
		};
		created = txn;
		return [...ledger, txn];
	});
	return created!;
}

export async function deletePromotionTransaction(leagueId: string, txnId: string): Promise<void> {
	await mutatePromotionLedger(leagueId, (ledger) => ledger.filter((t) => t.id !== txnId));
}

// ── Tier snapshot ────────────────────────────────────────────────────────────

/**
 * Replace one season's tier snapshot.
 *
 * Refuses an empty map: the snapshot is what every PP calculation keys off, so
 * writing `{}` would zero out the whole season's standings. An empty map is
 * never a legitimate intent — it only ever arises from an upstream failure
 * (e.g. a roster fetch that degraded to []), so it's rejected loudly here
 * rather than silently persisted.
 */
export async function setSeasonTiers(leagueId: string, season: string, tiers: Record<string, 1 | 2 | 3>): Promise<void> {
	if (Object.keys(tiers).length === 0) {
		throw new Error('Refusing to write an empty tier snapshot — this would erase the season\'s Promotion Points.');
	}
	await mutatePremierConfig(leagueId, (premier) => ({
		...premier,
		tiersBySeason: { ...premier.tiersBySeason, [season]: tiers },
	}));
	await deleteCache(cacheKey('promotionPointsCache', leagueId));
}

/** Persist budget/schedule settings without touching the ledger or tier snapshots. */
export async function setPremierSettings(
	leagueId: string,
	settings: Pick<PremierConfig, 'auctionBudget' | 'faabBudget' | 'tradeBudgetCap' | 'regularSeasonEndWeek'>,
): Promise<void> {
	await mutatePremierConfig(leagueId, (premier) => ({ ...premier, ...settings }));
	await deleteCache(cacheKey('promotionPointsCache', leagueId));
}

/**
 * Seed the CURRENT season's tier snapshot from Sleeper's roster.settings.division.
 * Only ever call this for the live season's own leagueId — Sleeper's division
 * mutates on promotion, so seeding a past season's leagueId would just copy
 * whatever the division field happens to say *today*, not what it was when
 * those games were played. See docs/PREMIER_KEEPERS.md "Why tiers are snapshotted".
 */
export async function seedTiersFromSleeper(leagueId: string): Promise<{ season: string; tiers: Record<string, 1 | 2 | 3> }> {
	const { league, rosters } = await fetchLeagueCore(leagueId);
	const tiers: Record<string, 1 | 2 | 3> = {};
	for (const r of rosters) {
		const div = r.settings?.division;
		if (div === 1 || div === 2 || div === 3) tiers[String(r.roster_id)] = div;
	}
	await setSeasonTiers(leagueId, league.season, tiers);
	return { season: league.season, tiers };
}

// ── Weekly PP walk (cached) ──────────────────────────────────────────────────

// Bumped for the addition of pointsForByRoster (Bug 3): older cached entries
// don't have it, so bumping forces a rebuild instead of silently deserializing
// without the field.
const PP_SCHEMA_VERSION = 2;
const PP_LIVE_TTL_MS = 15 * 60 * 1000; // in-progress seasons refresh every 15 min

interface SeasonMatchupPP {
	season: string;
	status: string;
	/** League progress signals (Sleeper `settings.leg` / `last_scored_leg`), carried
	 *  through so callers (e.g. getTierProjection) can tell whether a given week has
	 *  actually been played without re-fetching fetchLeagueCore themselves. */
	leg: number | undefined;
	lastScoredLeg: number | undefined;
	regularSeasonEndWeek: number;
	breakdown: PPBreakdown[];
	/**
	 * Regular-season (Weeks 1..regularSeasonEndWeek) points scored per roster,
	 * summed straight off the raw weekly matchup data — independent of tierMap
	 * membership and independent of whether a roster had a valid paired
	 * opponent that week. `breakdown` rows only exist when BOTH sides of a
	 * matchup are in the tier map (see computeWeekPP's filter in the pure
	 * engine), so deriving Points For from `breakdown` lets a gap in the tier
	 * snapshot silently corrupt the §II playoff-seeding tiebreaker. This is
	 * sourced before any tier filtering so it can't be affected by one.
	 */
	pointsForByRoster: Record<number, number>;
	tierMap: TierMap;
	rosterIds: number[];
}

async function buildSeasonMatchupPP(leagueId: string): Promise<SeasonMatchupPP> {
	const [{ league, rosters }, cfg] = await Promise.all([fetchLeagueCore(leagueId), getLeagueConfig(leagueId)]);

	const premier = withPremierDefaults(cfg);
	const regularSeasonEndWeek = premier.regularSeasonEndWeek;

	const tierMap: TierMap = {};
	for (const [rid, tier] of Object.entries(premier.tiersBySeason[league.season] ?? {})) tierMap[Number(rid)] = tier;

	// Completed weeks are immutable — read through the shared Sleeper matchup
	// cache (src/lib/server/sleeperCache.ts, already used by matchups.ts).
	// A season still in progress fetches live so an in-progress week's score
	// is never permanently cached mid-game; the outer cachedFetch below still
	// rate-limits repeat calls via its own short TTL.
	//
	// Deliberately NOT caught per-week: a genuinely empty week (nothing
	// scheduled yet) resolves to [] and is legitimate, but a *failed* fetch
	// must reject the whole Promise.all rather than silently degrade to [].
	// Swallowing it here would let a transient Sleeper blip produce a
	// truncated season that then gets cached forever once `complete` is true
	// (see isFresh below) — wrong PP numbers with no way to self-heal. Letting
	// it throw means buildSeasonMatchupPP rejects, cachedFetch's fetcher()
	// throws before writeCache runs, and the next request just retries.
	const complete = league.status === 'complete';
	const weeks = Array.from({ length: regularSeasonEndWeek }, (_, i) => i + 1);
	const weekDataArr = await Promise.all(
		weeks.map((w) => (complete ? getCachedMatchups(leagueId, w) : fetchMatchups(leagueId, w))),
	);

	const weekMatchups = weeks.map((w, i) => ({
		week: w,
		matchups: (weekDataArr[i] ?? []).map(
			(m): RawWeekMatchup => ({ rosterId: m.roster_id, matchupId: m.matchup_id, points: m.points ?? 0 }),
		),
	}));

	// Every roster present in a week's raw response counts toward Points For,
	// regardless of tier-map membership or whether it had a valid paired
	// opponent — see the field doc on SeasonMatchupPP.pointsForByRoster.
	const pointsForByRoster: Record<number, number> = {};
	for (const { matchups } of weekMatchups) {
		for (const m of matchups) pointsForByRoster[m.rosterId] = (pointsForByRoster[m.rosterId] ?? 0) + m.points;
	}

	return {
		season: league.season,
		status: league.status,
		leg: league.settings.leg,
		lastScoredLeg: league.settings.last_scored_leg,
		regularSeasonEndWeek,
		breakdown: computeSeasonPP(weekMatchups, tierMap),
		pointsForByRoster,
		tierMap,
		rosterIds: rosters.map((r) => r.roster_id),
	};
}

function getSeasonMatchupPP(leagueId: string): Promise<SeasonMatchupPP> {
	return cachedFetch<SeasonMatchupPP>(cacheKey('promotionPointsCache', leagueId), {
		schemaVersion: PP_SCHEMA_VERSION,
		isFresh: (env) =>
			env.schemaVersion === PP_SCHEMA_VERSION && (env.value.status === 'complete' || Date.now() - env.cachedAt < PP_LIVE_TTL_MS),
		fetcher: () => buildSeasonMatchupPP(leagueId),
	});
}

// ── Season standings (weekly PP + manual adjustments) ───────────────────────

/** A roster's full-season PP tally, itemized into matchup-derived vs manual. */
export interface RosterSeasonPP {
	rosterId: number;
	tier: Tier;
	/** Sum of every week's h2h + leagueMedian + tierMedian total. */
	weeklyTotal: number;
	/** Net of this season's manual ledger entries (collusion, neglect, other). */
	manualAdjustment: number;
	/** weeklyTotal + manualAdjustment — what tier movement is decided on. */
	totalPP: number;
	/** Season points scored — the §II tiebreaker. */
	pointsFor: number;
}

export interface SeasonPromotionPoints {
	season: string;
	status: string;
	/** League progress signals, threaded through from buildSeasonMatchupPP for
	 *  getTierProjection to use — see hasPlayInWeekBeenPlayed. */
	leg: number | undefined;
	lastScoredLeg: number | undefined;
	regularSeasonEndWeek: number;
	/** Full itemized weekly breakdown — the "show the work" data for the UI. */
	breakdown: PPBreakdown[];
	/** Per-roster season totals, sorted by tier then rank within tier. */
	standings: RosterSeasonPP[];
	/** This season's manual ledger entries only (for display alongside the breakdown). */
	manualLedger: PromotionTransaction[];
}

export async function getSeasonPromotionPoints(leagueId: string): Promise<SeasonPromotionPoints> {
	const [matchupPP, ledger] = await Promise.all([getSeasonMatchupPP(leagueId), getPromotionLedger(leagueId)]);
	const { season, status, leg, lastScoredLeg, regularSeasonEndWeek, breakdown, pointsForByRoster, tierMap, rosterIds } = matchupPP;

	const seasonLedger = ledger.filter((t) => t.season === season);
	const manualNet = netFromPromotionLedger(seasonLedger);

	// Points For comes straight off buildSeasonMatchupPP's raw weekly totals —
	// deliberately NOT re-derived from `breakdown` here, since a breakdown row
	// only exists when both the roster and its opponent are in the tier map. A
	// gap in the tier snapshot must never be able to corrupt the §II tiebreaker.
	const standings: RosterSeasonPP[] = rosterIds
		.filter((rid) => tierMap[rid] !== undefined)
		.map((rid) => {
			const weeklyTotal = sumSeasonPP(breakdown, rid);
			const manualAdjustment = manualNet[String(rid)] ?? 0;
			return {
				rosterId: rid,
				tier: tierMap[rid],
				weeklyTotal,
				manualAdjustment,
				totalPP: weeklyTotal + manualAdjustment,
				pointsFor: pointsForByRoster[rid] ?? 0,
			};
		});

	standings.sort((a, b) => a.tier - b.tier || b.totalPP - a.totalPP || b.pointsFor - a.pointsFor);

	return { season, status, leg, lastScoredLeg, regularSeasonEndWeek, breakdown, standings, manualLedger: seasonLedger };
}

// ── Promotion / relegation projection ────────────────────────────────────────

export interface TierProjection {
	standings: RosterSeasonPP[];
	playIns: PlayInMatchup[];
	movements: Movement[];
	/** Tiers with fewer than 4 rosters in the snapshot — play-ins can't be built for these. */
	incompleteTiers: Tier[];
}

/**
 * Whether the play-in week's Sleeper scores are real results rather than
 * placeholder zeros. Sleeper scores every roster every week regardless of
 * whether that week's matchups were ever scheduled — a week that hasn't
 * happened yet still comes back as a full array of rosters (with real,
 * *non-zero* points carried over from whatever the projection/last-scored
 * state happens to be, per live verification against the API), so map size
 * alone can never distinguish "played" from "not played". The league's own
 * progress signals can: a fully `complete` season, or Sleeper's
 * `settings.last_scored_leg` (the last week it has actually finished
 * scoring) / `settings.leg` (the week it's currently on) having advanced
 * past the play-in week.
 */
export function hasPlayInWeekBeenPlayed(
	status: string,
	lastScoredLeg: number | undefined,
	leg: number | undefined,
	playInWeek: number,
): boolean {
	if (status === 'complete') return true;
	// last_scored_leg is definitive — that week is fully scored.
	if (lastScoredLeg !== undefined) return lastScoredLeg >= playInWeek;
	// Fall back to `leg` (the week the league is currently on): only trust it
	// once the league has moved *past* the play-in week, since `leg` itself
	// may still be mid-scoring.
	if (leg !== undefined) return leg > playInWeek;
	return false;
}

/** Defensive backstop: even if the progress signals say a week is done, a
 *  map of all-zero scores looks exactly like Sleeper's not-played-yet
 *  placeholder, so refuse to treat it as decided. */
function hasAnyNonZeroPoints(points: Map<number, number>): boolean {
	for (const v of points.values()) if (v !== 0) return true;
	return false;
}

/**
 * Live promotion/relegation projection for the /tiers page. Play-in pairings
 * are always derived from current standings; the winner is resolved from
 * real Week 17 scores once that week has been played, otherwise each
 * matchup comes back with `winnerRosterId: null` (still TBD).
 */
export async function getTierProjection(leagueId: string, seasonPPArg?: SeasonPromotionPoints): Promise<TierProjection> {
	// Callers that already hold the season walk pass it in — recomputing it here
	// would double the Sleeper fan-out, since cachedFetch has no in-flight
	// dedup and two concurrent cold-cache calls both run the fetcher.
	const seasonPP = seasonPPArg ?? (await getSeasonPromotionPoints(leagueId));
	const tierRosters: TierRoster[] = seasonPP.standings.map((s) => ({
		rosterId: s.rosterId,
		tier: s.tier,
		totalPP: s.totalPP,
		pointsFor: s.pointsFor,
	}));

	// Only fetch the play-in week once the league says it has been played. When
	// it HAS been played the fetch is deliberately uncaught: silently degrading
	// to [] would render "nobody moves" as though it were the real outcome, and
	// on a relegation page a wrong answer is worse than an error.
	const weekReached = hasPlayInWeekBeenPlayed(seasonPP.status, seasonPP.lastScoredLeg, seasonPP.leg, PLAY_IN_WEEK);
	const week17Points = new Map<number, number>();
	if (weekReached) {
		const week17Raw = await (seasonPP.status === 'complete'
			? getCachedMatchups(leagueId, PLAY_IN_WEEK)
			: fetchMatchups(leagueId, PLAY_IN_WEEK));
		for (const m of week17Raw) week17Points.set(m.roster_id, m.points ?? 0);
	}

	const weekPlayed = weekReached && hasAnyNonZeroPoints(week17Points);
	const playIns = buildPlayInMatchups(tierRosters, weekPlayed ? week17Points : undefined);
	const movements = resolveTierMovements(tierRosters, playIns);

	// A tier short of 4 mapped rosters makes buildPlayInMatchups return nothing,
	// which is indistinguishable on the page from "no movement is due". Surface
	// the gap so an incomplete snapshot is visible rather than inferred.
	const mappedByTier = new Map<Tier, number>();
	for (const r of tierRosters) mappedByTier.set(r.tier, (mappedByTier.get(r.tier) ?? 0) + 1);
	const incompleteTiers = ([1, 2, 3] as Tier[]).filter((t) => (mappedByTier.get(t) ?? 0) < 4);

	return { standings: seasonPP.standings, playIns, movements, incompleteTiers };
}
