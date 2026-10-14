# Handoff — Premier Keepers

Orientation for a future session picking this up cold. Read
[PREMIER_KEEPERS.md](PREMIER_KEEPERS.md) first for the ruleset; this file covers
what exists in code, why it's shaped that way, and where the traps are.

## Where things stand

**Phase 1 (Tiers + Promotion Points) is complete.** Phases 2–4 are not started.

| Phase | Status |
|---|---|
| 1 — Tiers + Promotion Points | **Done** |
| 2 — Auction keeper valuation | Not started; deadline-driven (next auction draft) |
| 3 — Cross-tier playoff & play-in bracket | Not started |
| 4 — Dues, budgets, payouts | Not started |

## The one-paragraph summary

This app is a **companion** to Sleeper, never a replacement. Sleeper owns
rosters, scoring, matchups, and the auction draft. The app computes only what
Sleeper structurally cannot express: tier membership per season, Promotion
Points, per-tier budgets, auction-dollar keeper values, and the cross-tier
playoff shape. A second league (`ruleset: 'premier'`) coexists with the original
fantasy-tds league (`ruleset` absent ⇒ `'classic'`) in one deployment.

## Files

| File | Role |
|---|---|
| `src/lib/promotionPoints.ts` | **Pure** PP engine. No DB, no network, no `Date.now`. Award table, medians, neglect escalation, play-in seeding, tier-movement resolution. |
| `src/lib/promotionPoints.test.ts` | Unit tests for the above. |
| `src/lib/server/promotionPoints.ts` | All IO: cached season walk, PP ledger (Firestore transactions), tier snapshots, projection. |
| `src/lib/server/promotionPoints.test.ts` | IO-layer tests with mocked Sleeper/config seams. |
| `src/routes/league/[leagueId]/tiers/` | The league-facing page. |
| `src/routes/league/[leagueId]/admin/` | Ruleset toggle, tier snapshot editor, per-tier budgets, PP ledger form. |
| `src/lib/server/config.ts` | `ruleset`, `PremierConfig`, `PromotionTransaction`. |

The pure/IO split mirrors `keeperCost.ts` ↔ `server/keepers.ts` and
`superlativesEngine.ts` ↔ `server/superlatives.ts`. Keep new logic on the pure
side wherever it can live there — it's the only part that's cheaply testable.

## Traps — read before changing anything

**Sleeper's `roster.settings.division` is the CURRENT tier and mutates on
promotion.** It is *not* history. 2024's divisions in this league are placeholder
round-robin garbage (1,2,3,1,2,3…). Every PP calculation needs to know each
roster's tier *at the time the game was played*, so the app stores a per-season
snapshot in `premier.tiersBySeason` and treats Sleeper strictly as a seed source
for the live season. Never read tiers live from Sleeper for a historical week.

**Sleeper returns real, non-zero points for weeks that were never played.**
Verified live: week 18 of the 2025 league returns all 12 rosters with real scores
and `matchup_id: null`. So "did Sleeper give us data?" can never stand in for
"has this week happened?" — use `hasPlayInWeekBeenPlayed()`, which reads
`status` / `last_scored_leg` / `leg`.

**Every write to the `premier` block must go through `mutatePremierConfig`.** It
reads inside a Firestore transaction. Using `getLeagueConfig` +
`setLeagueConfig` instead reintroduces a real clobber: `getLeagueConfig` is
cached for 5 minutes, so a read-modify-write can silently revert PP ledger
entries written moments earlier.

**An empty tier snapshot is never legitimate.** `setSeasonTiers` throws on `{}`.
It only ever arises from an upstream failure (a roster fetch degrading to `[]`),
and persisting it would erase the season's entire PP standings.

**`cachedFetch` has no in-flight deduplication.** Two concurrent cold-cache
calls both run the fetcher. That's why `getTierProjection` accepts an optional
pre-computed `SeasonPromotionPoints` — the tiers page computes the season walk
once and hands it over instead of triggering a second 14-week fan-out.

**Completed seasons are cached forever** (`isFresh` returns true whenever
`status === 'complete'`). A partial result must therefore never be cached: week
fetches in `buildSeasonMatchupPP` are deliberately *not* individually caught, so
a transient failure rejects the build before `writeCache` runs. Don't "fix" that
by adding a `.catch`.

**`regularSeasonEndWeek` sizes a concurrent request fan-out** (one Sleeper call
per week). It's clamped to `[1, 18]` on both write and read.

## Rulings that aren't derivable from the constitution

Eight commissioner rulings are recorded in PREMIER_KEEPERS.md's Rulings table.
The ones most likely to surprise:

- **Loss to a higher tier = 0 PP** (losing up is expected). Losses are −1 to the
  same tier, −2 to a lower tier.
- **All ties = 0 PP** — head-to-head, league median, and tier median alike.
- **PP accrues Weeks 1–14 only.** No medians during the playoffs.
- **Play-in is Week 17**, and the pairing is best-challenger-vs-worst-incumbent.
- **Tier turnover is intentional.** Both bottom teams in Tiers I and II face a
  play-in every year; replaying 2025 moved 8 of 12 teams. Not a bug.

## Verifying changes against real data

The strongest check available is replaying the real 2025 season through the pure
engine — it needs no mocks, just Sleeper's public API. Known-good output for
league `1193452661344256000` (regular season, tiers seeded from Sleeper):

```
Tier I:   R9 61,  R4 22,  R3 16,  R7 -4
Tier II:  R11 37, R6 19,  R2 10,  R5 -5
Tier III: R8 11,  R10 7,  R12 1,  R1 -4
```

168 breakdown rows (12 rosters × 14 weeks). If a refactor changes these numbers,
it changed behavior — that's the signal. Fetch weeks 1–14 from
`api.sleeper.app/v1/league/<id>/matchups/<week>`, map to
`{rosterId, matchupId, points}`, and run `computeSeasonPP`.

## Open items

- **Roster slots drift.** Sleeper 2025 ran `QB, RB, RB, WR, WR, TE, FLEX, FLEX,
  K, DEF` + 5 BN; §I specifies 1 RB / 2 WR / 4 BN / 1 IR. Align one to the other.
- **Tier III budget outlier.** Roster 1 spent $127 in the 2025 auction against an
  implied $100 cap. Confirm whether they were Tier II at draft time.
- **PP history before 2025** is not recoverable from Sleeper. Backfilling 2024/23
  means hand-entering tier snapshots on each season's own league ID.
- **`RawMatchup.matchup_id` is typed `number`** but Sleeper returns `null` for
  unplayed weeks. Not currently hit — `pairWeekMatchups` drops non-pair groups —
  but the type is a lie worth tightening.

## Conventions

Branching is `dev → test → main` with a blocking fresh-context review on each
promotion; see [DEPLOYMENTS.md](DEPLOYMENTS.md). Features land on `dev`. Tests
are colocated `*.test.ts` (vitest). Tab indentation. Comments explain *why*, not
*what*. `npx vitest run` and `npm run build` both gate.
