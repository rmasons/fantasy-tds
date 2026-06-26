# Target architecture

> The map. Detailed data model + ingestion mechanics live in
> [STORAGE_AND_INGESTION.md](STORAGE_AND_INGESTION.md); the concrete first
> execution step lives in [PHASE1_APP_DATA_MIGRATION.md](PHASE1_APP_DATA_MIGRATION.md).

## The shape

Three independent tiers with a **portable Postgres database as the only stateful
contract** between them. Compute is swappable; data is the stable core.

```
 Sleeper API ──> [ Ingestion ]  ──writes sleeper.*──>  ┌────────────────────┐
                 Python, run by                        │   Postgres         │
                 GitHub Actions cron                    │  (always-warm,     │
                 (batch / backfill / finalize)          │   portable)        │
                                                        │                    │
                 [ Web app ] ──writes app.*──────────>  │  schema: app.*     │
                 SvelteKit, serverless    <──reads──────│  schema: sleeper.* │
                 (Vercel), stateless,     (sleeper.* RO)└────────────────────┘
                 read-mostly                                     ▲
                       │                                         │
                       └── one cached live Sleeper call ─────────┘
                           for the in-progress week only
```

- **Web tier** — SvelteKit on Vercel, **serverless** (stays as-is). Stateless and
  read-mostly: reads finalized history from `sleeper.*`, reads/writes operational
  data in `app.*`, and makes **one cached live Sleeper call** for the current week.
  Never ingests.
- **Ingestion tier** — a **standalone Python** service, run by **GitHub Actions on a
  schedule** (not a Vercel cron — that would re-couple it to the web runtime). Owns
  `sleeper.*` end to end (DDL + the only writer). Backfills history, finalizes
  rolled-over weeks.
- **Data tier** — one **always-warm, portable** managed Postgres. Two schemas with
  **DB-role separation** so the split is enforced, not just convention.

## Decisions settled (and the reasoning)

| Decision | Why |
|---|---|
| **Web stays serverless on Vercel** | The cold-start concern was the *database*, not the web tier. Serverless web costs $0, keeps preview-deploys as the `test` env, and the data tier being portable means we can re-host the web later without touching data. |
| **Relational Postgres** (not document, not OLAP) | Data is deeply relational (leagues→rosters→matchups→transactions, FAAB ledger, keepers). Relational *deletes* the Firestore workarounds. MotherDuck/DuckDB is OLAP — wrong for the transactional core (the egg-claim race especially) and overkill at this data scale. |
| **Always-warm, portable DB host** | No DB cold start (the real pain); standard connection string reachable from any web host *and* the Actions ingestion job. Rules out scale-to-zero free tiers (Neon free) and tiny caps (Supabase free 500MB) given the >1GB goal. |
| **Python ingestion, decoupled** | Python is the maintainer's primary language (with T-SQL) — owning the data layer in a known language keeps it self-maintainable, which is the whole point. Future data/analytics work is expected to land in Python too, so this is a foundation, not a one-off. A different language also forces a clean process boundary; runs as its own Actions job against the DB. The web app reads `sleeper.*` read-only with **generated** types (`drizzle-kit pull`), so the cross-language schema can't silently drift. |
| **Upstash stays** | On *serverless* there's no shared in-process memory, so an external cache + rate-limiter still earns its place. (This reverses the "retire Upstash" idea, which assumed an always-on server.) |
| **Firebase Auth stays** | Google login is valued and easy; moving auth is a separate, higher-risk project with no quota payoff. `users.uid` = Firebase uid. |

## Schema ownership (Python changes this)

Each schema is owned by its **writer's** toolchain; the reader mirrors, never owns.

| Schema | Owner / only writer | Migrations | Other tier's access |
|---|---|---|---|
| `app.*` (config, FAAB, users, keepers, superlatives, eggs) | **Web app** (Node) | **Drizzle** (`drizzle-kit`) — unchanged from Phase 1 | n/a (ingestion doesn't touch it) |
| `sleeper.*` (leagues, rosters, matchups, transactions, drafts, players) | **Ingestion** (Python) | **plain SQL migrations** via a neutral runner (e.g. `dbmate`) | Web reads it **read-only**; gets TS types via `drizzle-kit pull` (introspection) |

Why split the migration tooling: once Python writes `sleeper.*`, Drizzle can't own
those tables. Rather than force one ORM across two languages, each writer owns its
schema's DDL in its own toolchain, and the **database schema is the shared contract**.
The web app introspects `sleeper.*` for read types instead of generating them.

> Alternative if two migration systems feels like too much: make **all** DDL plain
> SQL migrations (one neutral source of truth), and let Drizzle be a pure typed query
> layer that mirrors it. Cleaner conceptually, but gives up Drizzle's
> generate-from-TS workflow for `app.*`. Defaulting to the per-writer split above.

## DB roles (enforce the split)

- `ingest_rw` — used by the Python job: **write** `sleeper.*`. No access to `app.*`.
- `web_rw` — used by the web app: **read/write** `app.*`, **read-only** `sleeper.*`.

So the web app *cannot* mutate ingested history even by accident, and the ingestion
job can't touch operational data. The boundary is permissions, not discipline.

## Host shortlist for the >1GB target

The growth is the ingested `sleeper.*` history (matchups carry per-roster
`players_points` jsonb across leagues × weeks × seasons); `app.*` stays tiny. Postgres
handles tens of GB on cheap tiers — size is a *tier-selector*, not a capability limit.
**Verify current pricing before committing.**

| Host | Cold start | ~Cost for >1GB always-warm | Notes |
|---|---|---|---|
| **Crunchy Bridge** (lead) | Never | ~**$10/mo flat** | Pure portable Postgres, generous storage, predictable, no caveats. Best fit for always-warm + >1GB + flat. |
| **Supabase Pro** | Never (Pro) | **$25/mo** (8GB incl.) | Free tier's 500MB cap rules it out for the goal. Pro bundles extras you may not need. |
| **Neon (paid)** | Disable autosuspend on paid | ~**$19/mo** | Branching maps to dev→test→prod. Free tier's scale-to-zero *is* the cold start we're avoiding. |
| **DigitalOcean Managed PG** | Never | ~**$15/mo** | Always-on, portable; pricier, more "platform." |
| **Turso (libSQL/SQLite)** | Never | cheap / generous free | Budget option; SQLite concurrency + OLTP caveats grow with "open to others." |

**Leaning Crunchy Bridge** for always-warm + portable + multi-GB + predictable-flat.

## Net vendor list

Vercel (web, free) · **portable Postgres** (data) · GitHub Actions (ingestion + CI) ·
Firebase Auth · Upstash (cache + rate-limit) · Sleeper (external).

**Retired:** Firestore (→ Postgres). **Optional cleanups:** Vercel Blob → a Postgres
`jsonb` row; Contentful → a Postgres-backed blog (removes per-league CMS onboarding).

## Operational pillars to add before cutover

1. **DB backups + a tested restore** — you're giving up Firestore's managed
   durability. Confirm automated daily backups (PITR ideally) and actually run a
   restore once.
2. **Migrations in CI** — apply `app.*` (Drizzle) and `sleeper.*` (SQL) migrations
   automatically per environment, in order, idempotently. Otherwise dev/test/prod
   drift.
3. **Error + memory observability** — Sentry free tier or structured logs + alerts.
   Matters more with in-process caches on serverless and a single DB.
