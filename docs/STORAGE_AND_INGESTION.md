# Storage & Sleeper ingestion — data model + mechanics

> Planning doc, not yet implemented. The at-a-glance map is
> [TARGET_ARCHITECTURE.md](TARGET_ARCHITECTURE.md); the first execution step is
> [PHASE1_APP_DATA_MIGRATION.md](PHASE1_APP_DATA_MIGRATION.md). This doc is the deep
> dive on the schema, the ingestion pipeline, and the live/history concatenation.

## Why / target

**Drivers:** Firestore free-tier read/write caps, expansion to multiple leagues
(planning for **>1GB** of data if it takes off), fewer/simpler vendors, and a
relational DB you can manage yourself with standard tooling.

**Target:** an **always-warm, portable** managed Postgres (standard connection
string, reachable from both the serverless web app and the Python ingestion job).
Host shortlist + the >1GB cost comparison live in
[TARGET_ARCHITECTURE.md](TARGET_ARCHITECTURE.md#host-shortlist-for-the-1gb-target)
— currently leaning **Crunchy Bridge (~$10/mo flat)**.

- **Keep:** Vercel (serverless web — the cold-start concern was the DB, not the web),
  Upstash (cache + rate-limit — still needed *because* the web is serverless),
  Firebase **Auth**, Sleeper (external).
- **Retire:** Firestore → Postgres. **Optional cleanups:** Vercel Blob → Postgres
  `jsonb`; Contentful → Postgres-backed blog.

## The split: ingestion is decoupled from the web app

The database is the **contract**. Ingestion *writes*; the web app *reads*. They share
a schema, not a runtime. (Full diagram + role/schema model in
[TARGET_ARCHITECTURE.md](TARGET_ARCHITECTURE.md).)

- **Ingestion** — standalone **Python**, run by **GitHub Actions on a schedule**.
  Owns and is the only writer of `sleeper.*`. Does backfill, daily refresh, and the
  "finalize" step. Never part of the web deploy.
- **Web** — serverless SvelteKit. Reads finalized history from `sleeper.*` (read-only
  role), reads/writes `app.*`, and makes **one cached live Sleeper call** for the
  in-progress week. The only "fresh data" path on the web side is that passive,
  cached read — not ingestion.

## Bonus: going relational deletes bespoke workarounds

- **FAAB ledger:** JSON-array-in-a-doc → a `faab_transactions` table; per-team net
  becomes `SUM(amount)`. The derived `faabBonuses` field and its keep-in-sync
  hardening go away entirely.
- **Egg claims:** Firestore `runTransaction` first-come → `UNIQUE(league_id, egg_id)`
  + `INSERT … ON CONFLICT DO NOTHING`. Atomic for free. (This is also exactly the
  transactional/OLTP pattern an OLAP engine like DuckDB/MotherDuck handles *worst* —
  one reason the store is row-store Postgres, not columnar.)
- **All-time analytics:** cross-season SQL instead of fetch-N-seasons-and-merge-in-JS
  (and no more `schemaVersion` cache games). At this data scale (thousands of rows,
  not hundreds of millions) plain Postgres runs these sub-millisecond — no warehouse
  needed.

## Schema

Two Postgres schemas, owned by different writers (see TARGET_ARCHITECTURE.md for the
ownership + migration-tooling split).

**`sleeper.*` — Sleeper-sourced (ingested by Python; idempotent upserts on the natural PK):**

| table | key | notable columns |
|---|---|---|
| `leagues` | `league_id` | season, name, status, `previous_league_id` (chain), total_rosters, settings(jsonb), `is_final` |
| `league_users` | (league_id, user_id) | display_name, team_name, avatar |
| `rosters` | (league_id, roster_id) | owner_id, co_owners[], wins/losses/ties, fpts, fpts_against, waiver_budget_used |
| `matchups` | (league_id, week, roster_id) | matchup_id, points, starters[], players[], players_points(jsonb), `is_final`, `last_synced_at` |
| `transactions` | `transaction_id` | league_id, week, type, status, status_updated, roster_ids[], waiver_bid, creator |
| `transaction_players` | (transaction_id, player_id) | action `add`/`drop`, roster_id — normalized for clean waiver/trade queries |
| `drafts` / `draft_picks` | draft_id / (draft_id, pick_no) | round, roster_id, player_id, is_keeper |
| `players` | `player_id` | name, position, team, years_exp — global, refreshed weekly |
| `nfl_state` | singleton | season, week, season_type |

> `matchups.players_points` (jsonb per roster per week) is the bulk that drives the
> >1GB growth; `app.*` stays tiny.

**`app.*` — app-owned (migrated from Firestore; written by the web app — Drizzle):**

See [PHASE1_APP_DATA_MIGRATION.md](PHASE1_APP_DATA_MIGRATION.md) for full DDL.
Summary: `app_config`, `league_config`, `faab_transactions`, `users`,
`manager_profiles`, `manager_league_profiles`, `keeper_selections`,
`keeper_overrides`, `superlatives`, `faab_eggs`.

Indexes: `sleeper.matchups(league_id, week)`, `sleeper.transactions(league_id, week)`,
`sleeper.transaction_players(player_id)`, `app.faab_transactions(league_id)`.

## Ingestion pipeline (Python)

**Stack (recommended — verify latest versions at build time):**

- **Python 3.12+**, deps managed with **`uv`** (fast, lockfile, trivial in Actions).
- **`httpx`** for Sleeper calls; **`pydantic` v2** to parse/validate the Sleeper
  payloads into typed models (doubles as documentation of the Sleeper shapes).
- **`psycopg` (v3)** with plain parameterized SQL + `execute_values` / `COPY` for
  bulk upserts, and `INSERT … ON CONFLICT DO UPDATE` for idempotency. Plain SQL
  (not a heavy ORM) suits a SQL-comfortable maintainer and keeps the writes
  transparent. *(SQLAlchemy Core is the alternative if a query builder is wanted.)*
- **Migrations for `sleeper.*`:** plain `.sql` files applied in order by a neutral
  runner — **`dbmate`** (single binary, language-agnostic, readable). Alembic only if
  you adopt SQLAlchemy.
- **Layout:** monorepo — a `/ingestion` Python package alongside the SvelteKit app.
  Hard-split into its own repo later if ever needed; the DB contract makes that cheap.
- **Config/secrets:** `DATABASE_URL` for the `ingest_rw` role, stored as a GitHub
  Actions secret. Never committed.

**Jobs:**

- **Backfill (one-time, per league chain):** walk `previous_league_id`; for each
  season upsert league/users/rosters/drafts/picks + every week's matchups +
  transactions; ingest `players` once. Fully idempotent — safe to re-run.
- **Daily (Actions cron):** current league + rosters (records change), `players`
  (weekly is enough), `nfl_state`, and **finalize** newly-immutable weeks.
- **Stat-correction window:** Sleeper adjusts points for ~2 days post-game, so keep
  re-pulling the just-finished week through ~Wednesday, then set `is_final = true` and
  never touch it again.

(Live in-game ingestion is intentionally out of scope — see below.)

## Scheduler: GitHub Actions, not a Vercel cron

Everything is daily-or-slower, and the point is to keep ingestion **off** the web
runtime:

- **GitHub Actions `schedule:`** runs the Python job (`uv run python -m ingestion.daily`)
  against the DB. Free, version-controlled, ~5-min granularity, fully decoupled from
  the web app. This is the chosen scheduler.
- A Vercel cron is explicitly **not** used for ingestion — it would run inside the web
  app and re-couple the two tiers. (The existing `warm-players` Vercel cron is folded
  into the Python daily job — see "App changes".)

## Live scoring is out of scope (deliberate)

Real-time in-game scoring is **not** ingested — Sleeper is where people go for live
stuff, and this app's value is the historical/analytics layer Sleeper doesn't have.

- The **current, in-progress week** is only as fresh as the web app's cached live read
  (below); mid-game numbers lag and that's acceptable.
- We never pull raw NFL stats / play-by-play — Sleeper returns league-scored player
  points, so a daily `matchups` pull is all that's needed. (This is also why
  row-store Postgres, not a warehouse/OLAP engine, is the right grain.)
- **Stat corrections:** revise for ~2 days after games, so keep re-pulling the most
  recent week until it settles (~Wed), then set `is_final` and freeze it.

## Near-real-time without a live poller: DB history + live current week

For each Sleeper data type, **read immutable history from the DB and the mutable
"current" slice live from Sleeper (short read-through cache), then concatenate.** The
live fetch is *passive* — it happens on page load in the **web app** and is cached in
Upstash, not on a tight cron — so freshness is bounded by cache TTL with zero extra
scheduling.

The rule:

- **Immutable past → DB** (`sleeper.*`, ingested once by Python, never re-read).
- **Mutable current → live Sleeper, cached** (one cheap call from the web app; TTL by urgency).
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
- Single Sleeper call per current-slice per league, cached in Upstash — cost is ~one
  call per TTL per league regardless of traffic.
- Derived features (trade analytics, superlatives, standings) get a current-season
  view "for free" by combining DB past-weeks + the live current week — no special cases.
- This makes the **Python daily job's only job "finalize"**: ingest the
  newly-immutable week(s) so they drop out of the live path. No sub-daily scheduling.

## App changes (web side)

- The `getCached*` modules (`sleeperCache`, `standings`, `matchups`, `transactions`,
  `tradeAnalyticsData`, …) become **"DB for finalized weeks + one live Sleeper call
  for the current week"** (per the table above), then hand the combined rows on. Past
  seasons are pure DB reads (read-only `sleeper.*` role).
- The pure engines (`tradeAnalytics`, `superlativesEngine`, etc.) keep working — feed
  them the concatenated rows instead of raw Sleeper fetches, so the well-tested logic
  is reused unchanged.
- **Keep Upstash** for the short cache on current-week live reads and for
  rate-limiting (serverless has no shared in-process memory, so an external store is
  still needed). The read-through cache for *finalized* data goes away — the DB is the
  warm store.
- **`warm-players` cron → Python daily job.** The blob-warming that ran as a Vercel
  cron moves into the ingestion job (it writes `sleeper.players` now). Its
  `CRON_SECRET` Bearer model retires with it.
- **Vercel Blob → Postgres.** The single player-snapshot blob becomes a `jsonb` row
  (e.g. `sleeper.player_snapshot(snapshot_date, schema_version, data)`); the in-memory
  cache in `players.ts` stays in front. Deletes `@vercel/blob`, the prune logic, and a
  health probe.
- **Contentful → Postgres-backed blog (optional cleanup).** The blog route is already
  a thin REST proxy; swap the Contentful `fetch` for a SQL read against a
  `blog_posts` table. Removes the per-league Contentful-space onboarding burden as you
  add leagues. Build a minimal admin editor (textarea + markdown). Defer if not worth
  it yet.
- **`vercel.json` redirects stay** (still on Vercel) — no change needed, unlike the
  off-Vercel scenario.

## Phased rollout

1. **App data first** (Phase 1). Stand up Postgres + `app.*`; migrate config, users,
   FAAB, keepers, superlatives, eggs; cut those modules over with a **pooled
   connection string** (serverless). Immediate quota relief; retires FAAB/egg
   workarounds. See [PHASE1_APP_DATA_MIGRATION.md](PHASE1_APP_DATA_MIGRATION.md).
2. **Build the Python ingestion service + `sleeper.*` schema**; backfill history.
3. **Point analytics / standings modules at SQL** (DB past + live current week).
4. **Daily + stat-correction ingest** (Actions cron). Fold in `warm-players`.
5. **Optional cleanups:** Vercel Blob → Postgres; Contentful → Postgres blog.

> Note: auth stays on Firebase throughout — there is no "migrate auth" phase. Keeping
> Google login is a feature, and moving auth would be a separate, higher-risk project
> with no quota payoff.
