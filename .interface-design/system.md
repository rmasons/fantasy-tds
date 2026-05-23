# fantasy-tds Design System

## Intent

**Who:** Fantasy league members — a close group of friends. Checking standings Thursday night before a game, looking up records to flex or suffer, reviewing transactions after a loss. Mobile-first, competitive, social.

**What they do:** Check standings fast, see their matchup, dig into historical records and all-time stats.

**Feel:** Championship energy. Stadium night. Scoreboard precision. Not generic SaaS — this is a private league app that should feel like it belongs to the sport. Dense like a broadcast graphic, warm like a trophy case.

---

## Accent Color

**Single accent: Amber**

- Primary: `amber-500` / `amber-400`
- Gradient partner: `orange-500` / `orange-600`
- Used for: active nav states, rank #1 highlights, avatar placeholders, hero accents, season selector active state
- Never used for: semantic states (those stay green/red), decorative fills

Rationale: Scoreboard gold, championship trophies, stadium lighting. Blue/violet is generic SaaS — amber is specific to this domain.

---

## Depth Strategy

**Borders-only.** No shadows.

- Standard border: `border-white/[0.07]` — replaces solid `border-slate-800`, softer and more professional
- Subtle row separator: `border-white/[0.05]`
- Emphasis border (active state, rank #1): `border-amber-400/60`
- Avatar rings: `ring-white/10` — not `ring-slate-700`

Do not mix approaches. No drop shadows on cards.

---

## Surfaces

Base canvas: `bg-slate-950`
Card / sidebar: `bg-slate-900`
Elevated (dropdown): `bg-slate-800`
Avatar placeholder: `bg-slate-800` (not `bg-slate-700`)

Same hue throughout, only lightness shifts. Sidebar uses `bg-slate-900` with `border-r border-white/[0.07]` — no color fragmentation.

---

## Typography

- All stat numbers: `font-mono tabular-nums` — consistent across every table and stat display
- Wins column bolder than losses column — hierarchy matches what matters to the reader
- Rank badges: `font-mono text-xs`
- Section labels: standard weight, `text-slate-500`, never uppercase-heavy

---

## Navigation

### Active state (sidebar + mobile)
```
bg-amber-500/10 border-l-2 border-amber-400 text-amber-50 font-semibold pl-[10px]
```

### Inactive + hover
```
text-slate-400 hover:text-white hover:bg-white/[0.05] border-l-2 border-transparent
```

### Season selector — active season
```
bg-amber-500 text-slate-950 font-bold
```

### Mobile nav dividers
`border-white/[0.07]` throughout

---

## Standings Table

### Row treatment
- Alternating: `bg-slate-950` / `bg-slate-900/20`
- Hover: `hover:bg-white/[0.03]`
- Row separator: `border-white/[0.05]`

### Rank #1 row
```
bg-amber-500/[0.07] border-l-2 border-amber-400/60
```

### Rank color scale
- #1: `text-amber-400 font-bold`
- #2: `text-slate-300 font-semibold`
- #3: `text-orange-600 font-semibold`
- Rest: `text-slate-600`

### PF for rank #1
```
text-amber-400 font-semibold
```
All other PF: `text-slate-200`
PA column: `text-slate-600` (de-emphasized)

---

## Hero Banner (Home Page)

```
border border-white/[0.07]
bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800/80
overlay: from-amber-500/8 via-transparent to-orange-600/5
top edge: bg-gradient-to-r from-transparent via-amber-400/40 to-transparent (h-px)
```

Avatar placeholder gradient: `from-amber-500 to-orange-500`

Teams badge: `bg-amber-500/10 text-amber-400 ring-amber-500/20`

---

## Semantic Colors (unchanged)

These are not accent colors — they communicate state:
- Active/live: `green-400` / `green-500/10`
- Playoffs: `amber-500/10 text-amber-400` (contextually appropriate)
- Win streak: `text-green-400 bg-green-500/10`
- Loss streak: `text-red-400 bg-red-500/10`
- Destructive: `hover:text-red-400`

---

## What to Avoid

- `blue-600`, `violet-600` as accent — replaced by amber throughout
- `border-slate-800` as a divider — use `border-white/[0.07]` instead
- `ring-slate-700` on avatars — use `ring-white/10`
- `bg-slate-700` for avatar placeholders — use `bg-slate-800`
- Mixed depth strategies (borders + shadows together)
- Multiple accent colors — amber only, semantic colors for status
