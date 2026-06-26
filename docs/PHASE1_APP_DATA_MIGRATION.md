# Phase 1 — migrate app-owned data off Firestore

Move the **app's own records** (config, users, profiles, FAAB, keepers,
superlatives, eggs) from Firestore to Postgres. **Auth stays on Firebase** this
phase. Sleeper-derived caches stay put (Phase 2). Goal: immediate Firestore-quota
relief + retire several bespoke workarounds, on a small, contained surface.

## In scope vs out of scope

**Migrate now (app-owned, system of record):**

| Firestore | → Postgres table | Owning module |
|---|---|---|
| `config/app` | `app_config` | `config.ts` |
| `leagueConfig/{id}` | `league_config` | `config.ts`, `faab.ts` |
| `leagueConfig.faabTransactions[]` | `faab_transactions` (own table) | `faab.ts` |
| `users/{uid}` | `users` | `user.ts` (+ layout, blog comments) |
| `managerProfiles/{sleeperId}` | `manager_profiles` | `managerProfile.ts` |
| `keeperSelections/{lg}/managers/{uid}` | `keeper_selections` | `keepers.ts` |
| `keeperData/{lg}/players/{pid}` (overrides) | `keeper_overrides` | `keepers.ts` |
| `superlativeHistory/*` | `superlatives` | `superlatives.ts` + API |
| `faabEggs/{lg}` | `faab_eggs` | faab-eggs route |

**Leave for Phase 2 (Sleeper-derived caches):** `keeperDraftHistory`, the
`keeperData/{lg}/players` *cache*, `players`, `leagues`, plus the Redis cache.
During Phase 1, `getKeeperData` reads `keeper_overrides` from Postgres but still
reads draft history from Firestore — a temporary cross-store read, fine.

**Untouched:** Firebase **Auth** (`admin.ts`, `session.ts`, `hooks.server.ts`),
`firestore.rules` (stays deny-all), Upstash, Vercel Blob, Sleeper.

## Stack

- **Target:** Supabase or Neon Postgres (pick per the storage doc).
- **Access:** **Drizzle ORM** — TS schema you own, generated SQL migrations, typed
  queries; self-manageable with `drizzle-kit`. (Plain `postgres`/SQL is fine too.)
- **Driver:** Neon → `@neondatabase/serverless` + `drizzle-orm/neon-http` (HTTP,
  no pooled-connection exhaustion on Vercel). Supabase → `postgres` (porsager) via
  the **transaction pooler** connection string.
- **Env:** `DATABASE_URL` per environment (prod vs preview/staging — maps onto the
  Vercel env-var plan).
- **Migrations:** `drizzle/` folder committed; you run `drizzle-kit generate` +
  `migrate` yourself.

## Schema (DDL)

```sql
create table app_config (
  id                boolean primary key default true check (id),  -- single row
  default_league_id text
);

create table league_config (
  league_id                   text primary key,   -- Sleeper league id (no FK; external)
  contentful_space_id         text,
  contentful_access_token     text,
  contentful_management_token text,
  enabled_nav_items           text[],             -- null = all defaults
  updated_at                  timestamptz not null default now()
);

-- replaces the nested array + the derived faabBonuses map entirely
create table faab_transactions (
  id           uuid primary key default gen_random_uuid(),
  league_id    text not null,
  roster_id    text not null,
  amount       integer not null,        -- signed: + grant, - penalty
  reason       text not null,
  created_by   text not null,
  is_migration boolean not null default false,
  created_at   timestamptz not null default now()
);
create index faab_tx_league on faab_transactions(league_id);
-- per-team net:  select roster_id, sum(amount) from faab_transactions
--                where league_id = $1 group by roster_id;

create table users (
  uid              text primary key,    -- Firebase Auth uid (auth stays on Firebase)
  email            text,
  sleeper_user_id  text,
  sleeper_username text,
  last_league_id   text,
  is_admin         boolean not null default false,
  updated_at       timestamptz not null default now()
);
create index users_sleeper on users(sleeper_user_id);

create table manager_profiles (
  sleeper_user_id    text primary key,
  display_name       text,
  first_name         text,
  last_name          text,
  email              text,
  bio                text,
  location           text,
  favorite_nfl_team  text,
  favorite_player    text,
  favorite_player_id text,
  preferred_contact  text,
  updated_at         timestamptz not null default now()
);
-- include manager_league_profiles(league_id, sleeper_user_id, …) only if
-- upsertManagerLeagueProfile is actually in use — confirm before adding.

create table keeper_selections (
  league_id     text not null,
  owner_user_id text not null,          -- Sleeper user id
  roster_id     integer,
  player_ids    text[] not null default '{}',
  updated_at    timestamptz not null default now(),
  primary key (league_id, owner_user_id)
);

create table keeper_overrides (
  league_id  text not null,
  player_id  text not null,
  base_cost  integer,
  years_kept integer,
  primary key (league_id, player_id)
);

create table superlatives (
  league_id  text not null,
  season     text not null,
  data       jsonb not null,            -- computed award set (flexible; normalize later if needed)
  updated_at timestamptz not null default now(),
  primary key (league_id, season)
);

create table faab_eggs (
  league_id    text not null,
  egg_id       text not null,
  claimed_by   text not null,
  display_name text not null,
  claimed_at   timestamptz not null default now(),
  primary key (league_id, egg_id)       -- UNIQUE gives atomic first-come for free
);
```

## Module changes (and the workarounds they delete)

- **`config.ts`** — `app_config` / `league_config` CRUD. Drop `faabBonuses` from the
  config entirely (now derived from `faab_transactions`).
- **`faab.ts`** — big simplification:
  - `getFaabLedger` → `select … order by created_at desc`.
  - net → `sum(amount) group by roster_id` (SQL).
  - `addFaabTransaction` → a single `INSERT`; `deleteFaabTransaction` → `DELETE by id`.
  - **Delete** `mutateLedger`/`runTransaction`, the net-sync, and `resolveLedger`'s
    migration synthesis (opening balances become real rows at migration time).
- **`keepers.ts`** — `keeper_selections` (get/set/clear) + `keeper_overrides` read;
  FAAB net via the `faab_transactions` sum. Draft-history read stays Firestore (P2).
- **`user.ts`** — `getUserProfileCached` reads `users` by Firebase uid; session/hooks
  unchanged. Keep the short in-memory cache.
- **`managerProfile.ts`** — `manager_profiles` get/upsert/batch; `redactManagerProfile`
  stays a pure function (untouched, still unit-tested).
- **`superlatives.ts` + API** — `superlatives` upsert/read by (league, season).
- **faab-eggs route** — GET → select; POST → `INSERT … ON CONFLICT (league_id, egg_id)
  DO NOTHING` (rows-affected = "won"), with the per-user cap checked in a single
  `BEGIN … COMMIT`. **Delete** the Firestore `runTransaction`.
- **`api/health`** — swap the `config` read for a `select 1` Postgres ping.
- **layout `users` write** (last-viewed league) and **blog comments `users` read** →
  `users` table.

## One-time data migration

`scripts/migrate-firestore-to-pg.mjs` (run once, idempotent):

1. Init `firebase-admin` (read) + the Postgres client (write).
2. Per collection: read all docs → transform → upsert (`ON CONFLICT DO UPDATE/NOTHING`).
   - `faabEggs/{lg}` doc is a `{eggId: claim}` map → expand to one row per egg.
   - `leagueConfig.faabTransactions[]` → rows in `faab_transactions` (preserve
     `is_migration`); legacy `faabBonuses` with no transactions → synthesize
     `is_migration` opening rows so net is preserved.
   - `keeperData/{lg}/players/*` → `keeper_overrides`; `keeperSelections/{lg}/managers/*`
     → `keeper_selections`.
3. Print row counts per table; spot-check a league against Firestore.

## Cutover & rollback

1. Create schema in the **staging** DB; run the migration against a Firestore export.
2. Deploy the Postgres-backed modules to **`test`** (preview env → staging DB); QA.
3. Run the migration against prod data; deploy to `main`.
4. **Rollback:** Firestore data is left untouched, so reverting the modules restores
   the old path. Optionally gate with a `STORAGE_BACKEND` env flag for a clean switch.

## Testing

- Pure-function tests (`redactManagerProfile`, `netFromLedger`, `keeperCost`,
  engines) are storage-agnostic — unchanged.
- Add light integration tests for the new query modules against a disposable test
  schema (or a mocked client).

## Effort

~8 tables, ~7 modules, 1 migration script — contained because storage already sits
behind these modules. Net code **shrinks** (the FAAB net-sync, egg transaction, and
keeper-cost cache plumbing all simplify).
