# Plan: Issue #168 — Atelier Zero: sleep page

**Issues covered:** #168
**Primary file:** `apps/web/src/app/sleep/page.tsx`
**Worktree (build phase will create):** `../whoop-dashboard-issue-168`
**Branch:** `issue/168-atelier-sleep`
**Depends on:** #165

## Context

Port `mockup-sleep.html` to React behind the Atelier flag. The classic sleep page is dense (donut, radar, debt, naps, bedtime patterns, etc.) — leave it alone. Atelier is a four-plate editorial layout: KPI row (4 stats), stage hypnogram + legend (FIG. 01), trend + consistency two-column (FIG. 02 / 03), need breakdown (FIG. 04), and a small bedtime-distribution table (TAB. 01). Headline: *"The night, recorded."*

## Files touched
- `apps/web/src/app/sleep/page.tsx` — wrap existing in `<div className="classic-sleep">`, append `<div className="atelier-sleep">` rendering new components.
- `apps/web/src/components/sleep/atelier/SleepHero.tsx` *(new)* — KPI row + headline (perf, total sleep, efficiency, latency).
- `apps/web/src/components/sleep/atelier/StagesPlate.tsx` *(new)* — proportional stage bar + legend + Roman-numeral metrics list (FIG. 01).
- `apps/web/src/components/sleep/atelier/SleepTrendCard.tsx` *(new)* — total-sleep & performance line over 14 days (FIG. 02).
- `apps/web/src/components/sleep/atelier/SleepConsistencyCard.tsx` *(new)* — bedtime/wake jitter chart over 14 days (FIG. 03).
- `apps/web/src/components/sleep/atelier/NeedBreakdown.tsx` *(new)* — sleep need decomposition (baseline / debt / strain / nap) (FIG. 04).
- `apps/web/src/components/sleep/atelier/BedtimeDistribution.tsx` *(new)* — small table of avg bedtime / wake by day-of-week (TAB. 01).
- `apps/web/src/app/theme.css` — append `.atelier-sleep *` selectors.

## Architectural decisions

- **Decision: do not reuse the classic `SleepStageDonut` / `SleepStagesChart` Recharts components in Atelier.** They have Recharts grids, dark tooltips, neon palette. Atelier wants the proportional bar (already prototyped in `AtelierCharts.SleepStageChart`) — extract that shape into `StagesPlate`.
- **Decision: stage colors set by mockup spec — deep `#2a3a5c`, REM `#4a4a6a`, light `#8b8696`, awake = coral (`#ed6f5c`).** Defined inline in components; do not add new CSS variables since these are component-scoped.
- **Decision: latency is *not* in `SleepRow` today.** The `AtelierCharts.SleepStageChart` shows "Latency —" because nothing populates it. For the Atelier sleep KPI row, render `—` for latency and leave a TODO comment referencing the planned `latency_ms` column. Do not add a column in this issue.
- **Decision: need breakdown reuses `need_from_baseline_ms / need_from_debt_ms / need_from_strain_ms / need_from_nap_ms` already on `SleepRow`.** No new query.
- **Decision: 14-day window for trend + consistency, mirroring classic page's `trend14`.** Use existing `getFullSleepTrend(14)` (already loaded by classic page).
- **Decision: bedtime distribution by day-of-week computed inline from `start_local`.** Uses `start_local` already on `SleepRow`. Group by weekday, average start hour and end hour. Skip rows where `start_local` is null. Helper goes in the component file (≤30 LOC).

## Implementation steps

1. **`sleep/page.tsx`** — keep all existing data loads. The page already has `latestSleep`, `trend14`, `trend90`, `naps` — all needed by Atelier.

2. **`SleepHero.tsx`** *(new)* — props: `latest: SleepRow | null`. Render plate header (Roman I., "Sleep / Plate Nº 01", page count "001 / 008"), italic headline "The night, *recorded*.", and a 4-card KPI row:
   - Performance (`latest.performance` %)
   - Total sleep (`(in_bed_ms - awake_ms)` formatted h Xm)
   - Efficiency (`latest.efficiency` %)
   - Disturbances (`latest.disturbances` count)
   Reuse `fmtMs` from `AtelierKPIGrid` — promote to a shared util in `apps/web/src/lib/atelier-format.ts` *(new)* with `fmtMs`, `pickAxisLabels` (also created in #167; coordinate the file ownership).

3. **`StagesPlate.tsx`** *(new)* — props: `latest: SleepRow | null`. Identical to `AtelierCharts.SleepStageChart` but elevated to its own card with a plate header "FIG. 01 / SL-26" and a side stats column (efficiency, disturbances, latency `—`). Add a tiny hypnogram if time allows; otherwise stage proportional bar + legend is sufficient (mockup keeps the proportional bar prominent).

4. **`SleepTrendCard.tsx`** *(new)* — props: `rows: SleepRow[]`. Two-line chart over 14 days: total-sleep hours (coral) and need hours (mustard). Re-use `smoothPath`/`sparklinePoints`. 5-tick date axis from `pickAxisLabels`. Plate header "FIG. 02 / SL-26".

5. **`SleepConsistencyCard.tsx`** *(new)* — props: `rows: SleepRow[]`. Plot bedtime hour and wake hour for last 14 nights (parsed from `start_local` / `end_local`). Two horizontal scatter rows (bedtime, wake), x-axis = date. Hairline target line at user's median bedtime. Plate "FIG. 03 / SL-26".

6. **`NeedBreakdown.tsx`** *(new)* — props: `latest: SleepRow | null`. Stacked horizontal bar showing the 4 components of `sleep_need_ms`: baseline, debt, strain, nap. 4-row legend with Roman i / ii / iii / iv. Plate "FIG. 04 / SL-26".

7. **`BedtimeDistribution.tsx`** *(new)* — props: `rows: SleepRow[]` (use `trend90` for stable averages). Compute, per weekday Mon–Sun: avg bedtime hour, avg wake hour, sample count. Render small table with Roman numerals. Plate "TAB. 01 / SL-26".

8. **`sleep/page.tsx`** — wrap existing JSX in `<div className="classic-sleep">`, append:
   ```tsx
   <div className="atelier-sleep">
     <SleepHero latest={latestSleep} />
     <StagesPlate latest={latestSleep} />
     <div className="atelier-sleep-row-2">
       <SleepTrendCard rows={trend14} />
       <SleepConsistencyCard rows={trend14} />
     </div>
     <NeedBreakdown latest={latestSleep} />
     <BedtimeDistribution rows={trend90} />
   </div>
   ```

9. **`theme.css`** — append `.atelier-sleep`, `.atelier-sleep-row-2` (CSS grid 2-col), and per-component class blocks (`.atelier-sleep-hero`, `.atelier-stages-plate`, `.atelier-sleep-trend`, `.atelier-sleep-consistency`, `.atelier-sleep-need`, `.atelier-bedtime-table`). Scope under `:root[data-theme="atelier"]`. Stage colors hardcoded inline in JSX, not CSS.

## Code structure (skeletons)

```tsx
// StagesPlate.tsx
type Props = { latest: SleepRow | null };
// .atelier-stages-plate
//   .atelier-plate-head ("FIG. 01 / SL-26 · {start_local}→{end_local}")
//   .atelier-stages-headline ("The night, recorded.")
//   .atelier-stages-bar (4 segments — same code as AtelierCharts SleepStageChart)
//   .atelier-stages-legend (4 rows: roman, label, ms-formatted)
//   .atelier-stages-stats (Efficiency · Disturbances · Latency —)
```

```ts
// lib/atelier-format.ts (new shared util, also used by #167)
export function fmtMs(ms: number | null | undefined): string { /* same as AtelierKPIGrid */ }
export function fmtHours(ms: number | null | undefined, precision = 1): string;
export function pickAxisLabels(rows: { date: string }[], count = 5): string[];
```

## Patterns to follow
- DB reads: existing exports (`getFullSleepTrend`, `getOverview`, `getLatestSleep`).
- All atelier classes prefixed `atelier-sleep-*`; CSS scoped under `:root[data-theme="atelier"]`.
- Reuse `lib/atelier-format.ts` for shared helpers; don't redefine per-component.
- No new npm deps; SVG hand-rolled.

## Acceptance criteria (from issue)
- [ ] `<div className="atelier-sleep">` parallel to classic; classic untouched.
- [ ] Stage colors: deep `#2a3a5c`, REM `#4a4a6a`, light `#8b8696`, awake `#ed6f5c`.
- [ ] Atelier Zero tokens (paper bg, Playfair italic display, Roman numerals, hairline borders).
- [ ] Real data only (latency renders `—` until column lands; no fake values).

## Verification
- `npm run build` clean.
- whoop-dev up → `/sleep` classic unchanged.
- Set `od-theme=atelier` cookie, reload → Atelier sleep tree renders with last night's stage breakdown, 14-day trend, and bedtime table.
- agent-browser screenshot atelier `/sleep`; cross-check against `mockup-sleep.html`.

## Out of scope (explicit)
- No edits to classic sleep components (`SleepStageDonut`, `SleepStagesChart`, `NapCalendar`, `SleepDebtChart`, etc.).
- No new DB columns (latency stays absent; documented `—`).
- No new analytics modules.
- No nap/REM-density visualization in Atelier (mockup doesn't have one).
- Bedtime distribution table is computed inline; no new `@/lib/analytics/bedtime.ts` exports.

## Cross-cutting note
`lib/atelier-format.ts` and `lib/atelier-axis.ts` are introduced by #167 and #168. Whichever ships first creates the file; the other appends. The build phase should sequence #167 → #168 if conflicts are expected. Both helpers are pure utilities; merge conflicts are trivial.
