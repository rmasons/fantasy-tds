# Code Review — Keepers Feature + Profile Enhancements

Commits reviewed: `8564638` → `59adeb2`

---

## Critical (fix before keeper deadline)

### 1. Missing authorization on keepers write endpoints
**Files:** `src/routes/api/keepers/+server.ts` — PATCH (line 30), DELETE (line 47), POST (line 58)

All three mutating handlers check only `locals.user` (any logged-in user), not `locals.user?.isAdmin`. Any league member can modify keeper overrides, import players, or invalidate the draft cache by hitting the API directly.

**Fix:** Replace `if (!locals.user) throw error(401, ...)` with `if (!locals.user?.isAdmin) throw error(403, 'Forbidden')` on PATCH, DELETE, POST.

---

### 2. `playerId` not validated before use as Firestore document ID
**Files:** `src/routes/api/keepers/+server.ts` — line 34 (PATCH), line 50 (DELETE)

`playerId` from the request body / query params is passed directly to `.doc(playerId)` without sanitizing. Firestore document IDs cannot contain `/` and have other constraints.

**Fix:** Add a validator alongside `validateLeagueId`:
```ts
function validatePlayerId(id: string | null): string {
  if (!id) throw error(400, 'Missing playerId');
  if (!/^\w{1,30}$/.test(id)) throw error(400, 'Invalid playerId');
  return id;
}
```

---

### 3. Import payload does not validate `baseCost` / `yearsKept` types
**Files:** `src/routes/api/keepers/+server.ts` — lines 71–73

Only `playerId` is checked in the filter. Malformed entries (e.g. `baseCost: "DROP TABLE"`) pass through to `importPlayers` and are written to Firestore.

**Fix:**
```ts
const entries = (body.players as any[]).filter(
  e =>
    typeof e.playerId === 'string' && /^\w{1,30}$/.test(e.playerId) &&
    (e.baseCost === undefined || e.baseCost === null || typeof e.baseCost === 'number') &&
    (e.yearsKept === undefined || (Number.isInteger(e.yearsKept) && e.yearsKept >= 0))
);
```

---

## Bugs

### 4. `expandedRow` goes stale on window resize
**File:** `src/routes/league/[leagueId]/rosters/+page.svelte` — lines 27–35

`colCount` updates on resize but `expandedRow` (a row index derived from `colCount`) is not reset. A row that was expanded in 3-col layout points to different cards after resizing to 1-col.

**Fix:** Add `expandedRow = null;` inside `updateCols()`.

---

### 5. `refreshDraftCache` ignores fetch failures
**File:** `src/routes/league/[leagueId]/keepers/+page.svelte` — lines 192–203

The fetch result is never checked. If the request fails (401, 502, network error), `load()` still fires, giving a false impression the cache was refreshed.

**Fix:**
```ts
const res = await fetch(...);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
await load();
```

---

### 6. `roundToBaseCost` returns negative for deep leagues (17+ rounds)
**File:** `src/lib/server/keepers.ts` — line 35

`80 - 5 * round` goes negative at round 17. `calcKeeperCost` has a `< 1 ? 5 : baseCost` fallback, but the raw negative value is exposed in the UI as the "base cost" before the override kicks in.

**Fix:** `return Math.max(5, 80 - 5 * round);`

---

### 7. `awards/+page.svelte` silently swallows `/api/profiles` errors
**File:** `src/routes/league/[leagueId]/awards/+page.svelte` — line 118

`.catch(() => {})` suppresses all failures. Real names silently do not load with no indication why.

**Fix:** Log the error: `.catch(e => console.warn('[awards] profiles fetch failed:', e));`

---

## Code Quality

### 8. `parseInt` missing radix
**File:** `src/lib/server/keepers.ts` — line 174

```ts
parseInt(planningYear) - parseInt(draftInfo.season)
```

Both calls are missing the radix argument. Use `parseInt(x, 10)` or `Number(x)`.

---

### 9. `sleeperGet` has no timeout
**File:** `src/lib/server/keepers.ts` — lines 43–47

`walkDraftHistory` calls `sleeperGet` in a serial loop with no timeout. A slow or hanging Sleeper response blocks the request indefinitely.

**Fix:** Pass an `AbortSignal.timeout(5000)` to each fetch call.

---

### 10. Commissioner mode checkbox available to all logged-in users
**File:** `src/routes/league/[leagueId]/keepers/+page.svelte` — lines 223–231

The "Commissioner mode" toggle is shown to any `data.user`, not just admins. Combined with issue #1, this means any member can edit keeper data. After fixing #1 (API-level auth), the UI should also be gated so non-admins never see the controls.

**Fix:** Change `{#if data.user}` to `{#if (data as any).user?.isAdmin}` (or thread `isAdmin` through `PageData`).

---

## Performance

### 11. Full players cache parsed on every keeper request
**File:** `src/lib/server/keepers.ts` — line 152

`JSON.parse(playersCacheDoc.data()!.data)` re-parses the entire NFL players blob on every `GET /api/keepers`. Add a module-level in-memory cache with a short TTL (5–10 min) to avoid repeated parsing.

---

### 12. `rosterFaabAfter(roster)` computed twice per card render
**File:** `src/routes/league/[leagueId]/keepers/+page.svelte` — lines 326–327 and 446

Called once in the roster header and once in the footer. Use `{@const faabLeft = rosterFaabAfter(roster)}` at the top of the card block to deduplicate.

---

## Status

| # | Severity | Fixed |
|---|---|---|
| 1 | Critical | ✅ |
| 2 | Critical | ✅ |
| 3 | Critical | ✅ |
| 4 | Bug | ✅ |
| 5 | Bug | ✅ |
| 6 | Bug | ✅ |
| 7 | Bug | ✅ |
| 8 | Quality | ✅ |
| 9 | Quality | ✅ |
| 10 | Quality | ✅ |
| 11 | Perf | ✅ |
| 12 | Perf | ✅ |
