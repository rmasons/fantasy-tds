# Fantasy TDs

A Sleeper companion app for fantasy football leagues that want more than the default experience — historical data across every season, keeper cost tools, all-time records, and end-of-season awards, all in one place.

Built with SvelteKit, Firebase, and the Sleeper API.

---

## What it does

### Historical year-walk
Every major page lets you browse any past season. Standings, matchups, power rankings, rosters, transactions, and the draft board are all navigable by year — not just the current one.

### Keepers cost calculator & planner
Prices every rostered player automatically based on the round they were originally drafted, how many years they've been kept, and your league's cost formula (keeper cap read from Sleeper's `max_keepers`). Admins can override base cost or years kept per player. A **scenario planner** lets managers toggle hypothetical keepers and see live cost / cap / budget impact before the draft.

Keeper years come from Sleeper's `is_keeper` draft flags, counted back season by season from the planning year — so a waiver pickup who was kept is priced as a keeper, and a player drafted years ago but since dropped and re-added starts over. Base cost is anchored to the draft that began the current keeper streak; players added off waivers/FA floor at $5. Run `node scripts/explain-keeper.mjs <leagueId> "Player Name"` to see the full trail for any rostered player.

### Trade & waiver analytics
A `/trades` page surfacing season and all-time insight from full transaction history: the most lopsided **trades** (draft-pick trades excluded, since a pick isn't a measurable point loss), and waiver-wire **Biggest Steals & FAAB Busts** (best- and worst-value pickups by starter points scored after acquisition).

### FAAB ledger
Commissioner FAAB grants and penalties as an auditable ledger — pick a manager, enter a signed amount and a reason. Every adjustment shows on a league-facing FAAB page, and the running net feeds each team's keeper budget.

### Playoff bracket
A visual tournament bracket with connecting lines showing how each round flows into the next. Available for any completed or in-progress season.

### Records
All-time league records across every season — single-game highs, season totals, and more — in one view.

### Superlatives
End-of-season awards computed from full matchup and transaction history: most points, biggest blowout, hottest win streak, most moves, and ~20 more. Admins can compute them automatically or edit individual entries.

### Manager profiles & rivalries
Per-manager pages with head-to-head history, season-by-season stats, and rivalry tracking. The rivalry analyzer auto-runs as soon as two managers are picked, and the page surfaces a weekly "grudge match" digest.

### Blog
Optional Contentful-backed blog for commissioner posts, recaps, and league lore.

---

## Branching & deployment

This project uses a **`dev → test → main`** flow with a blocking fresh-context
review on each promotion. See **[docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md)** for the
branch model, review gates, and the Vercel environment setup.

---

## Getting started

### Prerequisites
- Node.js 18+
- A [Sleeper](https://sleeper.com) league
- A Firebase project (Firestore + Authentication)
- Vercel account (for deployment)

### Local setup

```sh
npm install
cp .env.example .env
# Fill in .env — see Environment variables below
npm run dev
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `PUBLIC_FIREBASE_API_KEY` | Yes | Firebase client config |
| `PUBLIC_FIREBASE_AUTH_DOMAIN` | Yes | Firebase client config |
| `PUBLIC_FIREBASE_PROJECT_ID` | Yes | Firebase client config |
| `PUBLIC_FIREBASE_STORAGE_BUCKET` | Yes | Firebase client config |
| `PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Yes | Firebase client config |
| `PUBLIC_FIREBASE_APP_ID` | Yes | Firebase client config |
| `FIREBASE_SERVICE_ACCOUNT` | Yes | Full service account JSON as a single line (Firebase Console → Project Settings → Service Accounts) |
| `CRON_SECRET` | Yes | Protects the daily players-warming cron (`/api/cron/warm-players`). Vercel injects it automatically; add for local testing |
| `CONTENTFUL_SPACE_ID` | No | Required only if using the blog |
| `CONTENTFUL_ACCESS_TOKEN` | No | Required only if using the blog |
| `CONTENTFUL_MANAGEMENT_TOKEN` | No | Required for blog comments |

### Deployment

The app is built for Vercel. Push to `main` to deploy.

```sh
npm run build       # production build
npm run preview     # preview production build locally
```

Firestore rules/indexes (`firestore.rules`, `firestore.indexes.json`) deploy with
the Firebase CLI, which is intentionally **not** a project dependency — run it
on demand so it stays out of `node_modules`:

```sh
npx firebase-tools deploy --only firestore
```

---

## Admin setup

After logging in, navigate to `/admin` to:
- Register your Sleeper league ID
- Configure navigation items
- Set FAAB bonuses per roster
- Manage keeper overrides
- Compute or edit superlatives

---

## Highlights for league members

- **See every season** — not just the current one. Check how the standings looked in week 10 of 2021, or replay any matchup week.
- **Keeper costs** — before the draft, see exactly what every player on your roster would cost to keep based on when they were drafted and how long you've held them.
- **All-time records** — who holds the single-game scoring record? Who had the best season ever? It's all tracked.
- **End-of-season awards** — superlatives like "most points scored," "biggest blowout," and "hottest streak" are computed automatically from the full season and archived each year.
- **Playoff bracket** — the full tournament tree with scores, showing exactly how each round played out.
