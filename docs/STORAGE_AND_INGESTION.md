# Storage migration & Sleeper ingestion — scope

> Planning doc, not yet implemented. Decide against this before any code.

## Why / target

**Drivers:** Firestore free-tier read/write caps, expansion to multiple leagues,
fewer vendors, and a relational DB you can manage yourself with standard tooling.

**Recommendation:** **Supabase Postgres** — bundles the database, Auth, and
scheduled functions (`pg_cron` + Edge Functions) in one self-manageable platform,
so it retires Firebase entirely. **Neon** is the lower-risk alternative (DB only,
keep Firebase Auth). The schema below is identical either way.

- **Keep:** Upstash (cache + rate-limit; lightweight, different job), Sleeper (external).
- **Retire:** Firestore (and Firebase Auth, if Supabase).

## Bonus: going relational deletes bespoke workarounds

- **FAAB ledger:** JSON-array-in-a-doc → a `faab_transactions` table; per-team net
  becomes `SUM(amount)`. The derived `faabBonuses` field and its keep-in-sync
  hardening go away entirely.
- **Egg claims:** Firestore `runTransaction` first-come → `UNIQUE(league_id, egg_id)`
  + `INSERT … ON CONFLICT DO NOTHING`. Atomic for free.
- **All-time analytics:** cross-season SQL instead of fetch-N-seasons-and-merge-in-JS
  (and no more `schemaVersion` cache games).

## Normalized schema

**Sleeper-sourced (ingested; idempotent upserts on the natural PK):**

| table | key | notable columns |
|---|---|---|
| `leagues` | `league_id` | season, name, status, `previous_league_id` (chain), total_rosters, settings(jsonb), `is_final` |
| `league_users` | (league_id, user_id) | display_name, team_name, avatar |
| `rosters` | (league_id, roster_id) | owner_id, co_owners[], wins/losses/ties, fpts, fpts_against, waiver_budget_used |
| `matchups` | (league_id, week, roster_id) | matchup_id, points, starters[], players[], players_points(jsonb), `last_synced_at` |
| `transactions` | `transaction_id` | league_id, week, type, status, status_updated, roster_ids[], waiver_bid, creator |
| `transaction_players` | (transaction_id, player_id) | action `add`/`drop`, roster_id — normalized for clean waiver/trade queries |
| `drafts` / `draft_picks` | draft_id / (draft_id, pick_no) | round, roster_id, player_id, is_keeper |
| `players` | `player_id` | name, position, team, years_exp — global, refreshed weekly |
| `nfl_state` | singleton | season, week, season_type |

**App-owned (migrated from Firestore):**

| table | key | notes |
|---|---|---|
| `app_config` | singleton | default_league_id |
| `league_config` | `league_id` | contentful_*, enabled_nav_items[] |
| `app_users` | `id` | email, sleeper_user_id, sleeper_username, last_league_id, is_admin, profile fields |
| `faab_transactions` | `id` | league_id, roster_id, amount, reason, created_at, created_by, is_migration |
| `keeper_selections` | (league_id, owner_user_id) | player_ids[], updated_at |
| `keeper_overrides` | (league_id, player_id) | base_cost, years_kept |
| `superlatives` | (league_id, season, key) | value, manager_id |
| `faab_eggs` | (league_id, egg_id) | claimed_by, display_name, claimed_at |

Indexes: `matchups(league_id, week)`, `transactions(league_id, week)`,
`transaction_players(player_id)`, `faab_transactions(league_id)`.

## Ingest jobs

- **Backfill (one-time, per league chain):** walk `previous_league_id`; for each
  season upsert league/users/rosters/drafts/picks + every week's matchups +
  transactions; ingest `players` once. Fully idempotent.
- **Daily:** current league + rosters (records change), `players` (weekly is enough),
  `nfl_state`.
- **Stat-correction window:** Sleeper adjusts points for ~2 days post-game, so keep
  re-pulling the just-finished week through ~Wednesday, then set `is_final = true`
  and never touch it again.

(Live in-game ingestion is intentionally out of scope — see below.)

## Scheduler (in-stack — no GCP)

Everything is daily-or-slower (see "Live scoring is out of scope" below), so the
simplest option is enough:

- **Vercel Cron** — Hobby fires **once/day**, which now covers the whole pipeline.
  Adds to the existing `warm-players` cron.
- Upgrade paths *only if* you later want the in-progress week fresher than daily:
  **Supabase `pg_cron` → Edge Function**, or a **GitHub Actions `schedule:`** hitting
  an ingest route (both free, ~5-min granularity).

## Live scoring is out of scope (deliberate)

Real-time in-game scoring is **not** ingested — Sleeper is where people go for live
stuff, and this app's value is the historical/analytics layer Sleeper doesn't have.

- The **current, in-progress week** is only as fresh as the daily ingest, which is
  fine; mid-game numbers lag and that's acceptable.
- We never pull raw NFL stats / play-by-play — Sleeper returns league-scored player
  points, so a daily `matchups` pull is all that's needed. (This is also why
  Postgres, not a warehouse, is the right grain.)
- **Stat corrections:** Sleeper revises points for ~2 days after games, so keep
  re-pulling the most recent week until it settles (~Wed), then set `is_final` and
  freeze it. A flag + date check, no infrastructure.

## Near-real-time without a live poller: DB history + live current week

We don't need an active live poller (live in-game scoring is out of scope). Instead,
for each Sleeper data type, **read immutable history from the DB and the mutable
"current" slice live from Sleeper (short read-through cache), then concatenate.** The
live fetch is *passive* — it happens on page load and is cached, not on a tight cron —
so freshness is bounded by the cache TTL with zero extra scheduling.

The rule:

- **Immutable past → DB** (ingested once, never re-read).
- **Mutable current → live Sleeper, cached** (one cheap call; TTL by urgency).
- **Concatenate** for the full picture; derived analytics consume the combined stream.

| Data | Past (DB) | Current (live, cached) | Finalize → DB when |
|---|---|---|---|
| Transactions | weeks `< current` | current week, ~10 min | week rolls over (settle immediately) |
| Matchups / scores | finalized weeks | current week, ~30–60 min | ~2 days after games (stat corrections) |
| Standings / records / power rankings | from DB matchups | + current-week matchups | inherits matchups |
| Rosters (current state) | final snapshot per past season | live, ~15 min (no week dimension on Sleeper) | season ends |
| Drafts / picks | after the draft completes | live pre/mid-draft | draft `status = complete` |
| League meta / users | — | live, ~hourly (rarely changes) | n/a — just refresh |
| `nfl_state` | — | live, ~hourly | n/a |

Notes:

- **Transactions vs scores finalize differently:** a waiver/trade is never revised, so
  a week's transactions are final at rollover; scores get revised for ~2 days, so a
  matchup week is final ~Wed. Two different `is_final` triggers.
- Single Sleeper call per current-slice per league, cached in Upstash — so cost is
  ~one call per TTL per league regardless of traffic.
- Derived features (trade analytics, superlatives, standings) get a current-season
  view "for free" by combining DB past-weeks + the live current week — no special cases.
- This makes the **daily cron's only job "finalize"**: ingest the newly-immutable
  week(s) into the DB so they drop out of the live path. No sub-daily scheduling needed.

## App changes

- The `getCached*` modules (`sleeperCache`, `standings`, `matchups`,
  `transactions`, `tradeAnalyticsData`, …) become **"DB for finalized weeks +
  one live Sleeper call for the current week"** (per the table above), then hand the
  combined rows on. Past seasons are pure DB.
- The pure engines (`tradeAnalytics`, `superlativesEngine`, etc.) keep working —
  feed them the concatenated rows instead of raw Sleeper fetches, so the well-tested
  logic is reused unchanged.
- Drop the read-through Redis cache for *finalized* data (the DB is the warm store);
  keep a short Upstash cache on the **current-week live reads** and on rate-limiting.

## Phased rollout

1. **App data first.** Stand up Postgres + schema; migrate config, users, FAAB,
   keepers, superlatives, eggs; cut those modules over. Immediate quota relief and
   retires the FAAB/egg workarounds.
2. **Backfill history** into the normalized Sleeper tables; point analytics /
   standings modules at SQL.
3. **Daily + stat-correction ingest** (one Vercel cron).
4. **(If Supabase) migrate auth**, then delete Firebase.
