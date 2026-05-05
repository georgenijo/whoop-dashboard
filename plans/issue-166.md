# Plan: Issue #166 — Atelier Zero: overview page

**Issues covered:** #166
**Primary file:** `apps/web/src/app/page.tsx`
**Worktree (build phase will create):** `../whoop-dashboard-issue-166`
**Branch:** `issue/166-atelier-overview`
**Depends on:** #165 (theme foundation must be merged first)

## Context

The Atelier Overview is the showcase page for the redesign — Daily Bulletin (Plate Nº 04) headline, 8-card KPI grid, two-column charts (Recovery 30d + Sleep stages), and a three-column Stress / Hydration / Coach digest strip. Four parked components already exist (`DailyBulletin`, `AtelierKPIGrid`, `AtelierCharts`, `AtelierBottomStrip`); none are imported anywhere yet. This issue wires them into `app/page.tsx` behind the theme flag and adds the Atelier-only CSS for the new sections.

## Files touched
- `apps/web/src/app/page.tsx` — wrap existing JSX in `<div className="classic-overview">` and add a sibling `<div className="atelier-overview">` that renders the four parked components with the data already loaded server-side.
- `apps/web/src/app/theme.css` — append `.atelier-overview` and component-scoped CSS (`.bulletin-*`, `.atelier-kpi-*`, `.atelier-chart-*`, `.atelier-bottom-strip *`) gated under `:root[data-theme="atelier"]`.
- `apps/web/src/lib/db/body.ts` — read-only call from page; no edits.
- *(possible)* `apps/web/src/components/overview/AtelierBottomStrip.tsx` — only edit if hydration calc needs the actual `body_weight_kg` (currently defaults to 70). Pass through from `getBodyMeasurements()` instead.

## Architectural decisions

- **Decision: keep the parked components as-is; do not refactor them.** They're already wired with row types from `@/lib/db` and were drafted to match the mockup. Plan only adds the import + JSX wrapper + CSS.
- **Decision: render BOTH trees, gate via CSS (per #165 convention).** Both load the same server-side data (`getOverview`, `getRecoveryTrend`, `getDailySummary`, etc.) — there's no incremental DB cost since data is fetched once and passed into both trees.
- **Decision: pass real `body_weight_kg` from `getBodyMeasurements()` into `AtelierBottomStrip`.** The component currently defaults to 70 kg, which is fake data. Issue says "no mocks." Edit the prop site (`AtelierBottomStrip` already accepts `bodyWeightKg`); also consider replacing the `stepsPlaceholder` array in `AtelierKPIGrid` — but Whoop API doesn't expose steps and there's no `steps` column in the DB, so document that as known-gap and render `—` for steps until that data lands. Update `AtelierKPIGrid` to render `—` when no steps source exists rather than a fake number.
- **Decision: insight is reused from existing `getInsightStatus()` flow.** `app/page.tsx` already runs `acquireInsightRegenerationLock` + `regenerateInsight`. Pass `insightStatus.insight` to both `DailyBulletin` and `AtelierBottomStrip`. No new insight pipeline.
- **Decision: the existing `getOverview(days)` uses `getSleepTrend` (excludes naps), which is correct for the KPI grid.** No new query needed.
- **Decision: Atelier component CSS lives in `theme.css` under `:root[data-theme="atelier"] .bulletin-*` etc.** Don't bare-class them — that would leak Atelier styling into Classic. Each rule must be prefixed with `:root[data-theme="atelier"]`.

## Implementation steps

1. **`AtelierKPIGrid.tsx`** — replace the `stepsPlaceholder` array and hard-coded `latestSteps`/`prevSteps` with `null`-safe rendering. Update `KPICard` to accept `value: string | null` and render `"—"` when null. Same for the BarSpark which should render an empty placeholder when data is empty. Steps and BMR will be wired in a future issue.

2. **`page.tsx`** — extend the existing data block to also load body measurements (used for hydration estimate):
   ```ts
   import { getBodyMeasurements } from "@/lib/db";
   const body = getBodyMeasurements();
   ```
   This is a single read; cheap.

3. **`page.tsx`** — wrap the existing JSX (everything currently returned from `OverviewPage`) in `<div className="classic-overview">…</div>`. Append a sibling `<div className="atelier-overview">…</div>` that renders the four atelier components in order:
   ```tsx
   <DailyBulletin
     score={latestRecovery?.recovery_score ?? null}
     hrv={latestRecovery?.hrv ?? null}
     rhr={latestRecovery?.rhr ?? null}
     sleepPerf={data.latestSleep?.performance ?? null}
     respRate={data.latestSleep?.respiratory_rate ?? null}
     skinTemp={latestRecovery?.skin_temp ?? null}
     insight={insightStatus.insight}
     refreshing={insightRefreshing}
   />
   <AtelierKPIGrid
     latestRecovery={latestRecovery}
     previousRecovery={previousRecovery}
     latestCycle={data.latestCycle}
     previousCycle={data.previousCycle}
     latestSleep={data.latestSleep}
     previousSleep={data.previousSleep}
     recoveryTrend={data.recoveryTrend}
     strainTrend={data.strainTrend}
     sleepTrend={data.sleepTrend}
   />
   <AtelierCharts
     recoveryTrend={trend}
     latestSleep={data.latestSleep}
   />
   <AtelierBottomStrip
     latestRecovery={latestRecovery}
     latestCycle={data.latestCycle}
     latestSleep={data.latestSleep}
     insight={insightStatus.insight}
     bodyWeightKg={body?.weight_kilogram ?? undefined}
   />
   ```

4. **`theme.css`** — append a new section `/* Atelier — Overview */` and add scoped CSS for every class referenced by the four components. Use the mockup `whoop-dashboard-atelier.html` (lines 9–443) as the source of truth for tokens, font stacks, sizes, colors. All selectors must start with `:root[data-theme="atelier"]`. Required class blocks:
   - `.atelier-overview` (container, max-width, padding, vertical rhythm)
   - `.bulletin-section`, `.bulletin-header-row`, `.bulletin-section-label`, `.bulletin-roman-accent`, `.bulletin-meta`, `.bulletin-plate-num`, `.bulletin-body`, `.bulletin-left`, `.bulletin-tag`, `.bulletin-headline`, `.bulletin-blurb`, `.bulletin-figs`, `.bulletin-plate`, `.bulletin-plate-header`, `.bulletin-plate-body`, `.bulletin-ring-svg`, `.bulletin-metrics-list`, `.bulletin-metric-row`, `.bm-roman`, `.bm-label`, `.bm-value`
   - `.atelier-kpi-grid`, `.atelier-kpi-card`, `.atelier-kpi-top`, `.atelier-kpi-label`, `.atelier-kpi-roman`, `.atelier-kpi-value`, `.atelier-kpi-unit`, `.atelier-kpi-desc`, `.atelier-kpi-footer`, `.atelier-kpi-delta`, `.atelier-spark`
   - `.atelier-charts-row`, `.atelier-chart-card`, `.atelier-chart-header`, `.atelier-chart-title`, `.atelier-chart-sub`, `.atelier-chart-meta`, `.atelier-chart-fig`, `.atelier-chart-body`, `.atelier-chart-axis`, `.atelier-chart-empty`, `.atelier-recovery-chart`, `.atelier-sleep-chart`, `.atelier-sleep-bar`, `.atelier-sleep-legend`, `.atelier-sleep-stage-row`, `.atelier-sleep-dot`, `.atelier-sleep-stage-label`, `.atelier-sleep-stage-val`, `.atelier-sleep-stats`, `.atelier-sleep-dot-sep`
   - `.atelier-bottom-strip`, `.atelier-strip-col`, `.atelier-strip-eyebrow`, `.atelier-strip-big-serif`, `.atelier-strip-big-num`, `.atelier-strip-big-unit`, `.atelier-strip-meta`, `.atelier-strip-delta`, `.atelier-strip-delta--flat`, `.atelier-strip-coach-sentence`, `.atelier-strip-coach-footer`, `.atelier-strip-coach-link`

   Use `var(--paper)`, `var(--ink)`, `var(--coral)`, `var(--ink-faint)` etc. from #165. Headlines use `var(--font-display-serif)` italic; numerics use `var(--font-display-sans)` 800; mono labels use `var(--font-geist-mono)`. Hairline borders use `1px solid var(--line)`.

5. **No edits to** `RecoveryHero`, `KPIStrip`, `RecoveryTrend`, `AIInsightCard`, `AIInsightRefreshWatcher`, `PRsCard` — those stay inside `<div className="classic-overview">`.

## Code structure (skeletons)

```tsx
// app/page.tsx — final return shape
return (
  <>
    <div className="classic-overview">
      <div className="hero">
        <RecoveryHero … />
        <AIInsightCard … />
      </div>
      {insightStatus.isStale && insightRefreshing ? <AIInsightRefreshWatcher /> : null}
      <KPIStrip … />
      <PRsCard stats={prStats} />
      <div className="grid-main">
        <div className="col"><RecoveryTrend rows={trend} /></div>
        <div className="col" />
      </div>
    </div>

    <div className="atelier-overview">
      {insightStatus.isStale && insightRefreshing ? <AIInsightRefreshWatcher /> : null}
      <DailyBulletin … />
      <AtelierKPIGrid … />
      <AtelierCharts recoveryTrend={trend} latestSleep={data.latestSleep} />
      <AtelierBottomStrip … bodyWeightKg={body?.weight_kilogram ?? undefined} />
    </div>
  </>
);
```

## Patterns to follow
- DB reads through existing `safeQuery`-backed exports from `@/lib/db`.
- All new CSS in `theme.css`, scoped under `:root[data-theme="atelier"]`.
- `next/font` variables consumed via `var(--font-playfair-display)` etc. (registered in #165).
- No new npm deps.
- Do not introduce a new shared types module; keep using row types from `@/lib/db`.

## Acceptance criteria (from issue)
- [ ] `<div className="atelier-overview">` wraps the new tree; `<div className="classic-overview">` wraps the existing untouched tree.
- [ ] CSS gate honored via `data-theme="atelier"` (no atelier visible in classic mode).
- [ ] Real data only — no hard-coded numbers in the rendered output. Steps/BMR placeholders render `"—"` until real sources land.
- [ ] All four atelier components render with live recovery/sleep/strain/insight data.
- [ ] Hydration uses `body.weight_kilogram × 0.033` rounded to 1 decimal; falls back to `—` (not 70 kg) when no body data exists. Update `AtelierBottomStrip` to render `—` when `bodyWeightKg` is undefined rather than the current 70 kg default.

## Verification
- `cd apps/web && npm run build` — clean.
- whoop-dev up → open `/` with default cookie → identical to current Overview.
- POST `/api/theme` with body `atelier` (or use Settings toggle from #173 once merged) → reload → Atelier tree visible; check Daily Bulletin, KPI grid, charts, bottom strip render with real DB values.
- agent-browser screenshot of `/` Atelier mode; eyeball-compare against `whoop-dashboard-atelier.html` open in a browser.
- Verify via devtools: `.classic-overview` has `display: none` when atelier; `.atelier-overview` has `display: none` when classic.

## Out of scope (explicit)
- No edits to existing classic components (`RecoveryHero`, `KPIStrip`, etc.).
- No new charts library; SVG sparklines from `@/lib/paths` are sufficient.
- No edits to insight regeneration logic.
- No new chrome — sidebar/topbar reskin is handled at token-override level by #165.
- No steps integration — Whoop API doesn't expose steps; render `—`. Tracked separately.
