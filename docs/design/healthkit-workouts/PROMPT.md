# HealthKit Workouts + Stats — Screen Design Brief

OpenDesign reference mockups live alongside this file:
- `workout-detail.html` — Screen A, with HR stream
- `workout-detail-no-stream.html` — Screen A, graceful fallback (no HealthKit HR)
- `stats.html` — Screen B
- `index.html` — workouts list (reference for row → detail link)
- `assets/app.css` — the design system used by all four (matches the live app tokens)

Data/API contract: see `CONTRACT.md` in this folder.

## Design system (reuse, do not reinvent)
Dark theme; tokens `--fg-0..4`, `--font-mono`/`--font-sans`; `.card` / `.card-head` /
`.card-title` (+ colored `.dot`) / `.card-sub`; `.grid-main`/`.col`. Strain accent
`#ffaa00`; zone colors Z0`#1e3a8a` Z1`#2563eb` Z2`#06b6d4` Z3`#facc15` Z4`#f97316`
Z5`#b91c1c`; positive `#00d4aa`, negative `#ff6b6b`. Numbers `tabular-nums`.
The HR curve and trend in the mockups are hand-rolled inline SVG (zone-gradient area
fill) — port that approach; it's lighter than Recharts and already matches the theme.
New CSS classes used by the mockups (stat-strip, hr-chart, derived-grid, statc,
totals-strip, sport-row, record-card, trend-wrap, source-badge, backfill-note, etc.)
should be added to the app's global stylesheet.

## Base UI lift (T3 — prerequisite)
- New route `app/(dashboard)/workouts/[id]/page.tsx` (server, `force-dynamic`, `requireAuthOrSignin`).
- `WorkoutsTable` rows: replace inline accordion with a `Link` to `/workouts/[id]`. Keep the mini zone-bar cue.
- Add **Stats** nav item (bar-chart icon) to `Sidebar` (Dashboard group) + `BottomNav`. Scaffold `app/(dashboard)/stats/page.tsx`.
- New `lib/db` read fns: `getWorkoutById(userId,id)`, `getWorkoutHrSeries(userId,id)`.

## Screen A — Workout Detail (T4) — see workout-detail.html
Back-link + source badges (Whoop / HealthKit HR). Title row (sport icon + name + date·time·duration).
Hero `stat-strip`: Strain, Avg HR, Max HR, Energy, Distance (— when null).
Left col: **HR curve** (zone-gradient SVG area, peak marker, x=elapsed, y-gridlines at zone bounds)
when `hr_series` present; **HR Zones** bar + legend (reuse zone data). Right col:
**Effort & Recovery** derived grid (cardiac drift, recovery rate, time>90%, TRIMP — "Estimated" tag);
**Route & Pace** card → GPS placeholder when no distance (Whoop soccer), real map later for Watch workouts.
No `hr_series` → render `workout-detail-no-stream.html` variant: summary + zones only, tasteful "no HR detail captured" note.

## Screen B — Stats / History (T5) — see stats.html
Topbar with range pills (30D/90D/YTD/2026/All) extending the existing `?range=` pattern.
Sections: **All-time** totals strip (workouts, active time, distance, energy);
**YoY** card (`statc` comparison rows: current, vs-prior, delta arrow ▲/▼ colored, sparkline) with a
**backfill-note** until history is deep; **By sport** bar list; **Personal records** card grid;
**Year-over-year trend** (monthly rollup: bars=count, line=avg strain, partial months dimmed).
Real data via new `lib/db` aggregation fns (`getAllTimeStats`, `getYearComparison`, `getPersonalRecords`,
`getMonthlyRollup`) through `forUser()`. Honest empty/partial states — never fake zeros.

## Scope discipline (do NOT build)
No CTL/ATL/TSB fitness-fatigue modeling v1. No Apple sleep/steps/VO2max ingestion. No generic
HealthKit-import framework — only the two shapes in CONTRACT.md. Don't keep accordion AND detail page.
