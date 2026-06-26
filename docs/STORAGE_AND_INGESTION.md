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
- **In-game:** see below.

## Scheduler (in-stack — no GCP)

- **Supabase `pg_cron` → Edge Function** (pull + upsert) — lives next to the data, free.
- **GitHub Actions `schedule:`** → an ingest API route — free, already in your stack,
  ~5-min granularity.
- **Vercel Cron** — Hobby fires **once/day** (fine for backfill/daily, too coarse for live).

## In-game ingestion

Only the **current week's scoring** changes live, so the live pull is narrow:

- **current-week `matchups` per active league** — `players_points`,
  `starters_points`, team `points`. This is the primary live pull.
- **transactions** on the same/slower cadence (between-game waiver/FA/trade moves).
- **`nfl_state`** occasionally (week rollover).
- **Not needed:** raw NFL stats / play-by-play — Sleeper already returns
  league-scored player points. (This is why Postgres, not a warehouse, is plenty.)

**Cadence:** every ~2–5 min during game windows (Thu night; Sun ~1:00–11:30 pm ET;
Mon night); hourly/daily otherwise. **Current week only** — never re-ingest
completed weeks.

**Volume / limits:** one matchups call per league per tick. Sleeper's limit is
~1000 req/min, so even ~100 leagues every 2 min ≈ 50 req/min. Upserts keyed
`(league_id, week, roster_id)` are idempotent. Store `last_synced_at` so the UI
can show "updated 2 min ago".

**Live page:** reads the DB and polls every ~30–60 s (instead of bypassing cache to
hit Sleeper per request).

## App changes

- The `getCached*` modules (`sleeperCache`, `standings`, `matchups`,
  `transactions`, `tradeAnalyticsData`, …) collapse into SQL queries.
- The pure engines (`tradeAnalytics`, `superlativesEngine`, etc.) keep working —
  feed them DB rows instead of Sleeper fetches, so the well-tested logic is reused.
- Drop the read-through Redis cache for these (the DB is the warm store); keep
  Upstash for rate-limiting and any remaining hot caching.

## Phased rollout

1. **App data first.** Stand up Postgres + schema; migrate config, users, FAAB,
   keepers, superlatives, eggs; cut those modules over. Immediate quota relief and
   retires the FAAB/egg workarounds.
2. **Backfill history** into the normalized Sleeper tables; point analytics /
   standings modules at SQL.
3. **Daily + stat-correction ingest.**
4. **In-game ingester** (scheduler + endpoint); live page reads the DB.
5. **(If Supabase) migrate auth**, then delete Firebase.
