# Retiring the FAAB Easter Egg Hunt

This is a **manual** teardown checklist. Nothing removes the hunt automatically —
follow these steps when the league is done hunting. Do them all in one branch/PR
so the site is never left half-wired.

Two things make this clean: every egg placement is a single self-contained
`<FaabEasterEgg .../>` tag, and all egg metadata lives in one file
(`src/lib/eggs.ts`). Remove the placements, delete the plumbing, then optionally
wipe the stored claims.

---

## 1. Remove the egg placements (13 tags across 12 files)

Each is one `<FaabEasterEgg eggId="…" … />` tag embedded in surrounding markup.
Delete **just the tag** (and any `{#if …}` wrapper that exists *only* to gate the
egg) — leave the heading/label it sits next to intact. Then delete the now-unused
`import FaabEasterEgg from '$lib/components/FaabEasterEgg.svelte';` at the top of
each file.

| Egg | File | Where it sits |
|----|------|---------------|
| 1 | `src/routes/league/[leagueId]/standings/+page.svelte` | "PA" column header |
| 2 | `src/routes/league/[leagueId]/history/+page.svelte` | All-Time Lowest Scoring heading |
| 3 | `src/routes/league/[leagueId]/keepers/+page.svelte` | salary formula text |
| 4 | `src/routes/league/[leagueId]/matchups/+page.svelte` | Bracket tab label |
| 5 | `src/routes/league/[leagueId]/power-rankings/+page.svelte` | Score column header |
| 6 | `src/routes/league/[leagueId]/drafts/+page.svelte` | "Rd" column header |
| 7 | `src/routes/league/[leagueId]/rosters/+page.svelte` | Bench label (last team) |
| 8 | `src/routes/league/[leagueId]/superlatives/+page.svelte` | last award description |
| 9 | `src/routes/league/[leagueId]/history/+page.svelte` | All-Time Champions (2024 only) |
| 10 | `src/routes/league/[leagueId]/managers/+page.svelte` | "sorted by all-time record" footer |
| 11 | `src/routes/league/[leagueId]/blog/+page.svelte` | "All" category filter |
| 12 | `src/routes/league/[leagueId]/+page.svelte` | Week matchups heading |
| 13 | `src/routes/league/[leagueId]/blog/[slug]/+page.svelte` | latest blog post banner (`large`) |

> Note: eggs 2 and 9 are both in `history/+page.svelte` — two tags but a single
> shared import. Remove both tags, then remove the one import.

Quick way to find every remaining placement after you think you're done:

```sh
grep -rn "FaabEasterEgg\|eggId=" src/
```

It should return **nothing** when step 1 is complete.

---

## 2. Remove the keepers "FAAB Hunt" modal

In `src/routes/league/[leagueId]/keepers/+page.svelte`, delete the hunt-only code:

- `import { TOTAL_EGGS } from '$lib/eggs';`
- the `huntOpen` / `huntClaimed` / `huntLoading` state vars
- the `openHunt()` function
- the `onMount(() => { … ?hunt=1 … })` block (if `onMount` is used for nothing
  else, remove the `onMount` import too)
- the **💰 FAAB Hunt** button (around line 223)
- the entire `{#if huntOpen} … {/if}` modal block (incl. the "View the
  leaderboard →" link to `/hunt`)

---

## 3. Delete the dedicated files

```sh
rm src/lib/eggs.ts
rm src/lib/components/FaabEasterEgg.svelte
rm -r "src/routes/api/faab-eggs"
rm -r "src/routes/league/[leagueId]/hunt"
```

- `src/lib/eggs.ts` — shared metadata (also re-exported the `EggClaim` type).
- `FaabEasterEgg.svelte` — the egg badge/modal component.
- `api/faab-eggs/[leagueId]/+server.ts` — claim GET/POST endpoint.
- `league/[leagueId]/hunt/` — the leaderboard page (`+page.svelte` + `+page.server.ts`).

---

## 4. Catch the stragglers

The success modal text and links that mention the hunt are inside files you're
deleting, so they go with them. Sweep for anything left behind:

```sh
grep -rn "faab.?egg\|faabEggs\|/hunt\|FAAB Hunt\|easter" src/ -i
```

Expected after cleanup: no matches (or only unrelated FAAB-the-feature text).

---

## 5. Verify

```sh
npx svelte-kit sync
npx svelte-check --tsconfig ./tsconfig.json --threshold error   # expect 0 errors
npm run build
```

A dangling import or a `/hunt` link to a deleted route will surface here.

---

## 6. (Optional) Delete the stored claims

Claims live in Firestore at `faabEggs/{leagueId}`. Removing the code leaves these
documents orphaned but harmless. To wipe them, delete the doc(s) for each league
from the Firebase console, or with the Admin SDK:

```js
await adminDb().collection('faabEggs').doc('<leagueId>').delete();
```

Keep them if you want a record of who found what after the hunt ends.

---

## What this does NOT touch

- The real **FAAB bonus** admin feature (`faabBonuses` in league config / the admin
  panel) is unrelated to the egg hunt — leave it alone.
- Nothing here is wired to a cron, hook, or schedule, so there's no automation to
  unhook. Removal is purely deleting the code above.
