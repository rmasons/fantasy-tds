# Fantasy TDs — Roadmap

Forward-looking work, roughly ordered by payoff-to-effort. Near-term hardening
(write-endpoint tests, CI build gate, egg-hunt admin readout) is **done** and
lives in the test suite / CI. What's below is the next set of bets.

## Mid-term — lean into the historical-data edge

The app's differentiator is surfacing history that vanilla Sleeper doesn't.
Prefer deepening that over adding breadth.

- [ ] **Trade & transaction analytics** _(highest payoff-to-effort)_
  Full transaction history is already fetched and cached for superlatives, so
  the data cost is near zero. Surface: best/worst trade ever, waiver-wire ROI,
  FAAB-spent-vs-points-gained per manager. Net-new vs. Sleeper itself.
  - Source: `src/lib/server/transactions.ts`, `src/lib/server/superlatives.ts`.

- [ ] **Pre-draft keeper planning view**
  Keepers is the most differentiated tool. Add a "what if I keep X, Y, Z"
  scenario builder that prices combinations against the league cost formula
  before the draft. Highest in-season-to-draft usage.
  - Source: `src/lib/server/keepers.ts`, `src/routes/league/[leagueId]/keepers/`.

- [ ] **Manager rivalry / head-to-head digest**
  Rivalry tracking and Redis already exist. A weekly "this week's grudge match"
  summary gives a reason to open the app mid-season, not just at draft/playoffs.
  - Source: `src/lib/server/rivalry.ts`, `src/lib/server/managerProfile.ts`.

## Longer-term — only if engagement justifies the lift

- [ ] **Multi-league / public landing**
  Today the app is single-league-by-config. A public landing + league switching
  would make it shareable beyond one league.

- [ ] **Notification layer**
  The daily cron infra (`/api/cron/warm-players`) is a foothold. Could power
  draft reminders, rivalry digests, and "your keeper costs changed" alerts.

## Test/infra follow-ups (deferred deliberately)

- [ ] **Playwright smoke E2E** — a few browser flows (load a league, walk to a
  past season, open keepers) to cover route-level breakage unit tests can't.
  Deferred because it introduces a browser matrix + CI-time/flakiness tradeoff
  that should be a conscious choice, not a silent add. The CI `npm run build`
  gate covers the SSR/adapter regression class in the meantime.
