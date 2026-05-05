# Plan: Issue #167 — Atelier Zero: recovery page

**Issues covered:** #167
**Primary file:** `apps/web/src/app/recovery/page.tsx`
**Worktree (build phase will create):** `../whoop-dashboard-issue-167`
**Branch:** `issue/167-atelier-recovery`
**Depends on:** #165

## Context

Port `mockup-recovery.html` to React, gated behind the Atelier theme flag. The classic recovery page (which is dense — KPI strip, OvertrainingCard, DayOfWeek, two-column trends, illness signal, scatter, rebound) stays untouched. The Atelier version is editorially shaped: a hero with the headline "Recovery, measured over thirty mornings of breath, beats, and quiet nerves.", followed by Plate-numbered sections (recovery score line, HRV ledger, RHR baseline, three-zone distribution, and a 30-row chronological day ledger).

## Files touched
- `apps/web/src/app/recovery/page.tsx` — wrap existing JSX in `<div className="classic-recovery">`, add sibling `<div className="atelier-recovery">` rendering the new sections.
- `apps/web/src/components/recovery/atelier/RecoveryHero.tsx` *(new)* — headline + ring + side-list (analog of `DailyBulletin`, but recovery-only).
- `apps/web/src/components/recovery/atelier/RecoveryScoreChart.tsx` *(new)* — 30-day coral line+area (mockup `recovery-trend` section).
- `apps/web/src/components/recovery/atelier/HRVLedger.tsx` *(new)* — HRV trend chart (mockup `hrv-trend` section).
- `apps/web/src/components/recovery/atelier/RHRBaseline.tsx` *(new)* — RHR trend chart (mockup `rhr-trend` section).
- `apps/web/src/components/recovery/atelier/ZoneDistribution.tsx` *(new)* — counts of green/yellow/red mornings over 30d (mockup `zone-distribution` section).
- `apps/web/src/components/recovery/atelier/DayLedger.tsx` *(new)* — 30-row chronological table (date · score · zone · HRV bar · RHR bar) (mockup `day-ledger` section).
- `apps/web/src/lib/atelier-format.ts` *(new — shared with #168, #169)* — `pickAxisLabels` lives here. If #168 lands first, this file already exists; only append `pickAxisLabels`.
- `apps/web/src/app/theme.css` — append all `.atelier-recovery *` selectors gated under `:root[data-theme="atelier"]`.

## Architectural decisions

- **Decision: build five small Atelier-only components rather than one monolith.** The mockup has clear plate-numbered sections; one component per plate keeps each file under ~150 lines and lets the build worker iterate visually. Mirrors the `components/overview/` pattern used by Atelier components from #166.
- **Decision: reuse existing SVG path helpers (`smoothPath`, `sparklinePoints` from `@/lib/paths`) rather than introducing Recharts for Atelier.** The mockup is hand-drawn-looking SVG, not Recharts. Recharts wraps don't match the editorial aesthetic and would inherit Recharts default tooltips/grids. Direct SVG produces tighter visual fidelity to the mockup.
- **Decision: Atelier recovery uses `getRecoveryTrend(30)` regardless of `?range=` query.** Mockup's headline is "thirty mornings"; range parameter belongs to classic UI controls. Atelier ignores it.
- **Decision: zone distribution (red/yellow/green counts) computed inline, not in a new analytics module.** Three-line reduce; no need for `@/lib/analytics/recoveryZones.ts`.
- **Decision: the day ledger table renders all 30 rows; bars within each column scaled to that column's observed min/max.** Matches mockup. Compute min/max once over the 30 rows.

## Implementation steps

1. **Page data layer** (`recovery/page.tsx`) — keep all existing data loads. Add `const recovery30 = getRecoveryTrend(30);` if not already in scope (it's available via `trend30`). Add `const sleepLatest = getLatestSleep();` only if `RecoveryHero` needs sleep performance for the side-list (it does — see component).

2. **`RecoveryHero.tsx`** *(new)* — analog of `DailyBulletin`. Props: `score`, `hrv`, `rhr`, `spo2`, `skinTemp`, `respRate`. Layout per mockup `hero` section (lines 387–425): plate label "I. Recovery / Plate Nº 01", italic headline, recovery score ring (re-use SVG geometry from `DailyBulletin.tsx` lines 91–109; identical math), and a 5-row metric list with Roman numerals. No insight blurb here (Atelier coach digest lives elsewhere).

3. **`RecoveryScoreChart.tsx`** *(new)* — 30-day line+area. Props: `rows: RecoveryRow[]`. Uses `smoothPath(sparklinePoints(values, 100, 100))`. Coral fill at top (#ed6f5c, alpha 0.22 → 0). 33 / 67 horizontal hairlines (mockup uses these as zone band guides). Date axis: 5 ticks via `pickAxisLabels` from `@/lib/atelier-format.ts` *(new shared util — see Files touched; #168 and #169 also use it)*. If `lib/atelier-format.ts` doesn't exist yet, create it with `pickAxisLabels`. If it does (because #168 merged first), append `pickAxisLabels` only — do not touch existing exports.

4. **`HRVLedger.tsx`** *(new)* — same shape as RecoveryScoreChart but plots `hrv` (ms). Different gradient color stop set to `var(--olive)` per mockup. Title: "HRV, the *vagal* ledger."

5. **`RHRBaseline.tsx`** *(new)* — line chart of `rhr` (bpm). Inverted color treatment (low = good). Title: "Resting pulse, the *quiet* baseline."

6. **`ZoneDistribution.tsx`** *(new)* — three "stat" cards (green / yellow / red), each with count, % of 30, and small bar. Use `recoveryZone()` from `@/lib/format.ts` for classification. Display as a horizontal stacked bar plus three legend rows with Roman numerals i / ii / iii.

7. **`DayLedger.tsx`** *(new)* — table with columns: Date · Score · Zone tag · HRV bar (scaled to min/max of HRV column) · RHR bar (scaled to min/max of RHR column, inverted so lower=longer bar). Tag uses Atelier coral / mustard / olive depending on zone. Render newest first (slice and reverse from `recovery30` which is currently chronological asc).

8. **`recovery/page.tsx`** — wrap existing JSX in `<div className="classic-recovery">`. Append sibling:
   ```tsx
   <div className="atelier-recovery">
     <RecoveryHero
       score={data.latestRecovery?.recovery_score ?? null}
       hrv={data.latestRecovery?.hrv ?? null}
       rhr={data.latestRecovery?.rhr ?? null}
       spo2={data.latestRecovery?.spo2 ?? null}
       skinTemp={data.latestRecovery?.skin_temp ?? null}
       respRate={data.latestSleep?.respiratory_rate ?? null}
     />
     <RecoveryScoreChart rows={trend30} />
     <HRVLedger rows={trend30} />
     <RHRBaseline rows={trend30} />
     <ZoneDistribution rows={trend30} />
     <DayLedger rows={trend30} />
   </div>
   ```

9. **`theme.css`** — add `.atelier-recovery` container styles plus per-component selectors. Reference `whoop-dashboard-atelier.html` and `mockup-recovery.html` lines 1–380 for the token block, sec-rule, hero, chart-block, chart-stats, table styles. Scope every rule under `:root[data-theme="atelier"]`. Reuse the chart hairline + 33/67 zone-line styles from #166's `.atelier-recovery-chart` if possible — same chart, different data.

## Code structure (skeletons)

```tsx
// RecoveryHero.tsx
type Props = {
  score: number | null;
  hrv: number | null;
  rhr: number | null;
  spo2: number | null;
  skinTemp: number | null;
  respRate: number | null;
};
// Renders:
//   .atelier-recovery-hero
//     .atelier-sec-rule (Roman I · headline · plate Nº)
//     .atelier-hero-body
//       .atelier-hero-headline (Playfair italic, mockup line ~225)
//       .atelier-hero-ring (svg circle, re-use math from DailyBulletin)
//       .atelier-hero-metrics (5 Roman-numeral rows: HRV, RHR, SpO2, Skin Δ, Resp)
```

```tsx
// DayLedger.tsx
type Props = { rows: RecoveryRow[] };
// Compute hrvMin/hrvMax and rhrMin/rhrMax across rows once.
// Render <table className="atelier-day-ledger"> with thead and 30 tbody rows
// (rows.slice().reverse() → newest first).
// Each cell with a bar uses (val - min) / (max - min) → width%.
// Zone tag class: .tag.coral (green), .tag.mustard (yellow), .tag.coral-dim (red)
// — pick tokens from the mockup line 335.
```

```ts
// lib/atelier-format.ts — append (or create with) this export.
// File is shared with #168 (fmtMs, fmtHours) and #169 (consumers).
export function pickAxisLabels(rows: { date: string }[], count = 5): string[] {
  if (rows.length === 0) return [];
  const idx = [...new Set(
    Array.from({ length: count }, (_, i) =>
      Math.floor((rows.length - 1) * (i / (count - 1)))
    )
  )];
  return idx.map((i) => {
    const d = new Date(rows[i].date + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });
}
```

## Patterns to follow
- DB reads: existing exports from `@/lib/db` (`getRecoveryTrend`, `getOverview`, `getLatestSleep`).
- `recoveryZone()` from `@/lib/format.ts` for classification.
- SVG sparkline math from `@/lib/paths.ts`.
- Atelier CSS scoped under `:root[data-theme="atelier"]`; no bare-class atelier rules.
- No new npm deps. No Recharts in atelier components.

## Acceptance criteria (from issue)
- [ ] Built as `<div className="atelier-recovery">` parallel to existing classic; classic untouched.
- [ ] Atelier Zero tokens applied: warm paper bg, Playfair italic display, Inter Tight body, coral accents, Roman section numerals, hairline borders.
- [ ] Real Whoop data — 30 actual recovery rows in the day ledger; counts in zone distribution match the data.
- [ ] No mocks (no hard-coded numbers anywhere in the rendered tree).

## Verification
- `npm run build` clean (typecheck + ESLint pass).
- whoop-dev up → `/recovery` in classic mode unchanged.
- Set `od-theme=atelier`, reload `/recovery` → Atelier hero with real recovery score; charts render with live data; day ledger has 30 rows.
- agent-browser screenshot atelier `/recovery`; visually compare to `mockup-recovery.html`.

## Out of scope (explicit)
- No edits to classic recovery components (`OvertrainingCard`, `IllnessSignalCard`, `Spo2TrendCard`, `SkinTempDeviationCard`, `RecoveryReboundCard`, `StrainRecoveryScatter`, `DayOfWeekRecovery`, `KPIStrip`, `HRVTrend`, `TrendChart`).
- No new analytics in `@/lib/analytics/`.
- No range selector in Atelier — fixed 30-day window.
- No new tables, no schema changes, no npm deps.

## Cross-cutting note
`lib/atelier-format.ts` is shared with #168 and #169. #167 owns `pickAxisLabels` only; #168 owns `fmtMs` and `fmtHours`. Build sequencing: #168 → #167 → #169. Whichever lands first creates the file; the others append their own exports without touching others.
