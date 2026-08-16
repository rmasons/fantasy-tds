# Premier Keepers — league ruleset spec

A second league in this app, governed by its own constitution: three tiers with
promotion/relegation, auction drafting, dollar-valued keepers, and a
Promotion-Points system that decides who moves between tiers.

Sleeper league: `1193452661344256000` ("Premier TD's", 2025) →
`1106687629845790720` (2024) → `1003407046101798912` (2023).

This app is a **companion** to Sleeper, not a replacement. Sleeper stays the
system of record for rosters, scoring, matchups, and the auction draft. The app
computes only what Sleeper cannot express:

| Concept | Owner |
|---|---|
| Scoring (§V), roster slots (§I), auction draft, FAAB spend | Sleeper (native config) |
| Tier membership per season | **App** (Sleeper's `division` mutates; see below) |
| Promotion Points, league/tier medians | **App** |
| Per-tier auction & FAAB budgets | **App** (Sleeper has one league-wide value) |
| Auction-dollar keeper valuation | **App** |
| Cross-tier playoff + play-in bracket | **App** (Sleeper brackets used as raw data) |
| Dues, payouts, tradeable next-year budget | **App** |

---

## Rulings

Constitution ambiguities resolved by the commissioner, 2026-07-21.

| Item | Constitution says | Ruling |
|---|---|---|
| Tier size | "three divisions of six" (= 18 teams) | **4 teams × 3 tiers.** Original design was 18 teams; scaled down. |
| Loss to a **higher**-tier opponent | undefined | **0 PP** — losing up is expected |
| Medians during playoffs | undefined | **None.** PP accrues Weeks 1–14 only |
| Play-in week | undefined | **Week 17** (championship week 2) |
| Defense, 21–27 points allowed | no band listed | **0** |
| "Fubble Recovery" | typo | Fumble Recovery, **+2** |
| Tie (head-to-head or either median) | undefined | **0 PP** — applies uniformly to h2h ties, league-median ties, and tier-median ties |
| The 14th game | §II implies 13 (9 intra + 4 cross) but Weeks 1–14 is 14 | **Intra-tier, uniformly across all three tiers from 2026 forward.** Each team's schedule is 10 intra-tier games (full triple round-robin of 9, plus one 4th game against a single rival) + 4 cross-tier games (two from each of the other two tiers, matching §II as written). 2025 ran asymmetrically — Tier I played 9 intra + 5 cross, while Tiers II and III already played 10 intra + 4 cross — so only Tier I's shape changes for 2026. This is enforced when the commissioner builds the schedule in Sleeper; the app does not generate schedules, it only reads whatever shape Sleeper actually has for a given week. |
| Play-in seeding | §III names the participants (top 2 of the lower tier, bottom 2 of the upper) but not the pairing | **Best challenger vs worst incumbent.** Lower tier's #1 draws the upper tier's 4th place; lower tier's #2 draws the upper tier's 3rd place. |
| Tier turnover rate | — | **Accepted as designed.** With 4-team tiers, both bottom teams in Tiers I and II face a play-in every season, so up to half of each tier is exposed annually before automatic relegation is even applied. Replaying 2025 under these rules moved 8 of 12 teams. This is intended churn, not a bug — if it is ever revisited, the lever is one play-in per tier boundary instead of two. |

### Open items

- **Roster slots drift.** Sleeper 2025 ran `QB, RB, RB, WR, WR, TE, FLEX, FLEX,
  K, DEF` + 5 BN. §I specifies 1 RB / 2 WR / 4 BN / 1 IR. Align one to the other.
- **Tier III budget outlier.** Roster 1 spent $127 in the 2025 auction against
  an implied $100 Tier III cap. Confirm whether they were Tier II at draft time.

---

## Data model

### `LeagueConfig` additions (`src/lib/server/config.ts`)

```ts
ruleset?: 'classic' | 'premier';   // absent ⇒ 'classic'; fantasy-tds is unaffected

premier?: {
  /** Per-season tier snapshot. Sleeper's roster.settings.division reflects the
   *  CURRENT tier and mutates on promotion, so it cannot be trusted for history.
   *  Seeded from Sleeper for the live season, entered by hand for prior ones. */
  tiersBySeason: Record<string, Record<string, 1 | 2 | 3>>;  // season → rosterId → tier

  auctionBudget: { 1: number; 2: number; 3: number };  // 300 / 200 / 100
  faabBudget:    { 1: number; 2: number; 3: number };  // 300 / 200 / 100
  tradeBudgetCap:{ 1: number; 2: number; 3: number };  // 200 / 100 / 100 (§I)

  regularSeasonEndWeek: number;   // 14

  /** Manual PP adjustments — roster neglect, collusion. Source of truth. */
  promotionTransactions: PromotionTransaction[];
  /** rosterId → net of the above. Mirrors the faabBonuses/faabTransactions pair. */
  promotionAdjustments: Record<string, number>;
};
```

`PromotionTransaction` mirrors `FaabTransaction` exactly — `{id, rosterId,
season, amount, reason, kind, createdAt, createdBy}` — so the ledger UI, the
audit trail, and the admin form are near-copies of the FAAB ones.

### Why tiers are snapshotted

Sleeper's `roster.settings.division` is the *current* tier. Promotion rewrites
it. The 2025 league has correct Tier I/II/III names, but 2024's divisions were
assigned round-robin by roster ID (1,2,3,1,2,3…) — placeholder data. Every PP
calculation depends on knowing each opponent's tier **at the time the game was
played**, so the app stores the snapshot and treats Sleeper as a seed source
only.

### Per-tier budgets

Sleeper supports exactly one league-wide auction budget and one FAAB budget. In
2025 the per-tier caps were honor-system. The app makes them real:

- **FAAB** — set Sleeper to the Tier I value ($300), then post opening
  adjustments of −$100 (Tier II) and −$200 (Tier III) through the **existing
  FAAB ledger**. No new code; the keeper budget math already reads the net.
- **Auction** — config-only. The app displays and validates against the tier
  cap; Sleeper cannot enforce it during the draft.

---

## Promotion Points engine

### Award table (§III)

| Event | PP |
|---|---|
| Win vs Tier I opponent | +3 |
| Win vs Tier II opponent | +2 |
| Win vs Tier III opponent | +1 |
| Win vs League median | +1 |
| Win vs Tier median | +2 |
| Loss vs same-tier opponent | −1 |
| Loss vs lower-tier opponent | −2 |
| Loss vs higher-tier opponent | **0** (ruling) |
| Loss vs either median | −1 |
| Tie (head-to-head or either median) | **0** (ruling) — no win or loss credit on either side |
| Playoff losses | 0 |
| Collusion | −5 |
| Roster neglect — 1st / 2nd / 3rd / subsequent | −1 / −3 / −5 / −10 |

Medians: **league median** = median of all 12 scores that week; **tier median**
= median of the 4 scores in your tier. Both are computed Weeks 1–14 only.

### Shape

Split pure-from-IO the way `keeperCost.ts` and `superlativesEngine.ts` already
are in this repo:

- **`src/lib/promotionPoints.ts`** — pure. Takes
  `{week, rosterId, points, opponentRosterId}[]` plus a tier map, returns
  per-week per-roster PP deltas with an itemized breakdown (h2h / league median
  / tier median). Fully unit-testable with no network.
- **`src/lib/server/promotionPoints.ts`** — walks Weeks 1–14 through the
  existing matchup fetch + cache layer, folds in `promotionAdjustments`, and
  caches with `schemaVersion` + `isFresh` following `standings.ts`.

Roster-neglect escalation is **derived**, not entered: the admin picks "roster
neglect" and the app counts prior neglect entries for that roster this season to
pick −1 / −3 / −5 / −10. Prevents the commissioner from having to track offense
counts by hand.

### Promotion / relegation resolution (§III)

1. **Play-in (Week 17):** top two of Tier II and Tier III each face one of the
   bottom two in the tier above. Lower-tier winner is promoted, their opponent
   relegated. Higher-tier winner ⇒ no movement.
2. **Automatic relegation:** any team finishing below 0 PP drops a tier. The
   highest-PP team in the tier below is promoted to replace them — skipping any
   team that lost a play-in and was already relegated.

Seeding for the playoffs is by PP, with **Points For** as tiebreaker (§II).

---

## Phases

### Phase 1 — Tiers + Promotion Points

The league's defining mechanic, and the thing Sleeper cannot show at all.

- `ruleset` + `premier` config block, admin UI to set it
- Per-season tier snapshot; seed 2025 from Sleeper, enter 2024/2023 by hand
- `promotionPoints.ts` pure engine + unit tests
- `src/lib/server/promotionPoints.ts` with caching
- PP ledger (`promotionTransactions`) + admin form, modeled on the FAAB ledger
- **`/league/[leagueId]/tiers`** — PP standings per tier, itemized weekly
  breakdown, live promotion/relegation projection, sub-zero relegation flags
- Nav gated on `ruleset === 'premier'`

### Phase 2 — Auction keeper valuation

- Extract keeper pricing from `src/lib/server/keepers.ts` into a strategy chosen
  by `ruleset`:
  - `classic` — existing `roundToBaseCost` (R1 = $75 … floor $5)
  - `premier` — base = **max(auction price paid, FAAB winning bid)**. Auction
    price is `pick.metadata.amount` (present and populated in the 2025 draft);
    FAAB bids come from the transaction history already fetched for
    superlatives.
- Escalation `ceil(base × 1.2^yearsKept)` — §IV's worked example ($100 → 120 →
  144 → 173) confirms compounding on the *escalated* value, not the original.
- Value follows the player through trades. The existing draft-history walk is
  already player-keyed, so this falls out for free.
- Keeper limit 3 (Sleeper `max_keepers` already = 3), 72-hour deadline before
  the draft.
- Scenario planner reuses everything; only the budget denominator changes to the
  tier's $300 / $200 / $100.

### Phase 3 — Cross-tier playoff & play-in bracket

Weeks 15–17, two-week rounds, Tier II's 1st vs Tier I's 4th, etc. The 2025
season ran this through Sleeper's winners + losers brackets with manual
cross-tier seeding, so `getBracket()` has real data — this needs a `premier`
variant that labels rounds correctly and adds the Week 17 play-in, not a
from-scratch bracket engine.

### Phase 4 — Dues, budgets, payouts

$30 dues, prepaid-two-years status, tradeable next-season draft budget with tier
caps ($200 / $100 / $100), and the §VI payout table. Mostly a config-backed
ledger page.

---

## What comes for free

Because the app is already league-scoped via `/league/[leagueId]` and
per-league Firestore config, registering the Sleeper league ID in `/admin`
immediately yields: standings, matchups, power rankings, rosters, transactions,
trade analytics, drafts, records, superlatives, manager profiles, rivalries, and
the FAAB ledger. Phases 1–4 are strictly additive.
