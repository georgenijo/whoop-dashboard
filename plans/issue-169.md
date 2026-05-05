# Plan: Issue #169 — Atelier Zero: strain page

**Issues covered:** #169
**Primary file:** `apps/web/src/app/strain/page.tsx`
**Worktree (build phase will create):** `../whoop-dashboard-issue-169`
**Branch:** `issue/169-atelier-strain`
**Depends on:** #165

## Context

Port `mockup-strain.html` to React behind the Atelier flag. Classic strain page is a thin shell (KPI strip + two trend charts + TSB curve) — leave intact. Atelier version is plate-based: KPI row with primary today-strain ring (14.6 / 21 in mockup; live data here), 30-day strain bar chart panel, mini HR & kcal trend panels, and a workouts log table.

## Files touched
- `apps/web/src/app/strain/page.tsx` — wrap existing JSX in `<div className="classic-strain">`, append `<div className="atelier-strain">` rendering new components.
- `apps/web/src/components/strain/atelier/StrainHero.tsx` *(new)* — KPI row with primary today-strain ring + 3 secondary cards (weekly avg, max HR, 30d burn).
- `apps/web/src/components/strain/atelier/StrainBars.tsx` *(new)* — 30-day vertical bar chart panel.
- `apps/web/src/components/strain/atelier/HRTrend.tsx` *(new)* — mini line chart (avg HR over 30d).
- `apps/web/src/components/strain/atelier/KcalTrend.tsx` *(new)* — mini line chart (kcal over 30d).
- `apps/web/src/components/strain/atelier/WorkoutsTable.tsx` *(new)* — log table of recent workouts.
- `apps/web/src/app/theme.css` — append `.atelier-strain *` selectors.

## Architectural decisions

- **Decision: Atelier strain ring driven by `latestCycle.strain` divided by 21 (Whoop's max).** Same SVG geometry as `DailyBulletin.bulletin-ring-svg`; different color (coral `#ed6f5c`), different denominator. Centralize ring math in component, no shared util.
- **Decision: 30-day window fixed for Atelier.** Range parameter belongs to classic UI. Use `getStrainTrend(30)` (existing).
- **Decision: workouts log uses `getWorkouts(15)` — 15 rows, newest first.** Mockup shows ~10–15 entries. Already exported.
- **Decision: Max-HR card aggregates over the last 30 days from `getStrainTrend(30)` (cycles table).** Pull `max_hr` from cycle rows, take max, find which date — render that.
- **Decision: 30d burn (kcal) totaled from `kilojoule / 4.184` summed over the 30-day cycle window.** No new query.
- **Decision: do not render TSB curve in Atelier.** Mockup doesn't include it; keep the page tidy. TSB stays in classic.

## Implementation steps

1. **`strain/page.tsx`** — extend data loads. Currently has `data` (from `getOverview`), `trend` (`getStrainTrend(days)`), `tsbTrend`. Add:
   ```ts
   import { getStrainTrend, getWorkouts } from "@/lib/db";
   const trend30 = getStrainTrend(30);
   const recentWorkouts = getWorkouts(15);
   ```

2. **`StrainHero.tsx`** *(new)* — props: `latest: CycleRow | null`, `prev: CycleRow | null`, `trend30: CycleRow[]`. Compute:
   - Primary: `latest.strain` over 21, with arc `dasharray = 21π · strain / 21`. Coral stroke. Show delta vs `mean(trend30.slice(-7).strain)`.
   - Secondary 1: weekly avg (`mean(last 7 days strain)`), delta vs prior 7d.
   - Secondary 2: max HR over 30d (`max(trend30.max_hr)`), date label.
   - Secondary 3: 30d burn (`sum(trend30.kilojoule) / 4.184`), avg per day.
   Render plate header (Roman I., page 1/8). Mockup lines 550–610.

3. **`StrainBars.tsx`** *(new)* — props: `rows: CycleRow[]` (30d). Vertical bars (each 1 day), height = `strain / 21 * panelHeight`. Color coral; label every 7 days. Plate "Plate Nº 02 / FIG. 30-D-STRAIN". Avg-line overlay at `mean(rows.strain)` rendered as dashed hairline (`stroke-dasharray: 2 4`, `stroke: var(--ink-faint)`).

4. **`HRTrend.tsx`** *(new)* — small panel (`.panel.mini`). Line chart of `avg_hr` over 30 days. Color `var(--ink-mute)`. No fill. 3 axis ticks.

5. **`KcalTrend.tsx`** *(new)* — small panel. Line chart of `kilojoule / 4.184` over 30 days. Color `var(--mustard)`. No fill.

6. **`WorkoutsTable.tsx`** *(new)* — props: `rows: WorkoutRow[]`. Columns: Date · Sport · Duration · Strain · Avg HR · Max HR · kcal. Use Atelier table styles (Playfair Roman number prefix per row, mono numerics). 15 rows max. Plate "Plate Nº 05 / FIG. 30-D-LOG".

7. **`strain/page.tsx`** — wrap existing JSX in `<div className="classic-strain">`. Append:
   ```tsx
   <div className="atelier-strain">
     <StrainHero
       latest={data.latestCycle}
       prev={data.previousCycle}
       trend30={trend30}
     />
     <StrainBars rows={trend30} />
     <div className="atelier-strain-row-2">
       <HRTrend rows={trend30} />
       <KcalTrend rows={trend30} />
     </div>
     <WorkoutsTable rows={recentWorkouts} />
   </div>
   ```

8. **`theme.css`** — append `.atelier-strain *` selectors. Container vertical rhythm same as overview/recovery. Bar chart uses CSS variable `--coral` for fill. Mini panels share a `.atelier-mini-panel` class. Scope all under `:root[data-theme="atelier"]`.

## Code structure (skeletons)

```tsx
// StrainHero.tsx — primary ring
const strain = latest?.strain ?? 0;
const max = 21;
const r = 50;
const circ = 2 * Math.PI * r;
const dash = (strain / max) * circ;
// <svg viewBox="0 0 120 120">
//   <circle cx="60" cy="60" r="50" stroke={ink-faint-thin} stroke-width="6" fill="none"/>
//   <circle cx="60" cy="60" r="50" stroke="#ed6f5c" stroke-width="6" stroke-linecap="round"
//           stroke-dasharray={`${dash} ${circ}`} transform="rotate(-90 60 60)" fill="none"/>
// </svg>
```

```tsx
// StrainBars.tsx
type Props = { rows: CycleRow[] };
// Compute per-row heightPct = (strain / 21).
// Render 30 <rect> bars with x = i * (barW + gap), y = panelH - barH, width = barW, height = barH.
// Date label every 7 bars, mono 9px.
// avg overlay: <line stroke-dasharray="2 4" />.
```

## Patterns to follow
- DB reads: `getStrainTrend(30)`, `getOverview()`, `getWorkouts(15)`.
- Atelier classes prefixed `atelier-strain-*`; CSS scoped under `:root[data-theme="atelier"]`.
- Numerics: `var(--font-display-sans)`, weight 800, tabular nums.
- Headlines: `var(--font-display-serif)` italic.
- Reuse `fmtHours` / `pickAxisLabels` from `lib/atelier-format.ts` (created in #167/#168).
- No new npm deps. SVG hand-rolled.

## Acceptance criteria (from issue)
- [ ] `<div className="atelier-strain">` parallel to classic; classic untouched.
- [ ] Strain ring shows live `latest.strain / 21` (not the mockup's 14.6 hard value).
- [ ] 30-day strain bar chart with avg overlay and date labels.
- [ ] Workouts log table with 15 most-recent sessions.
- [ ] Atelier Zero tokens applied (paper bg, Playfair italic display, Roman numerals, hairline borders).
- [ ] Real Whoop data; no mocks.

## Verification
- `npm run build` clean.
- whoop-dev up → `/strain` classic unchanged.
- Set `od-theme=atelier`, reload → Atelier strain renders with today's actual strain, last-30 bars, recent workouts table.
- agent-browser screenshot atelier `/strain`; visual diff against `mockup-strain.html`.

## Out of scope (explicit)
- No edits to classic strain components (`KPIStrip`, `TrendChart`, `TSBCurve`).
- No TSB curve in Atelier (mockup omits it).
- No range selector in Atelier — fixed 30-day window.
- No new DB columns or analytics.
- No new npm deps.
