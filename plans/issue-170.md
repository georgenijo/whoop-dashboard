# Plan: Issue #170 — Atelier Zero: workouts page

**Issues covered:** #170
**Primary file:** `apps/web/src/app/workouts/page.tsx`
**Worktree (build phase will create):** `../whoop-dashboard-issue-170`
**Branch:** `issue/170-atelier-workouts`
**Depends on:** #165

## Context

Port `mockup-workouts.html` → React behind the Atelier flag. Classic page stays. Atelier version has a 4-card KPI row (volume, intensity, duration, max HR), then a two-column row: workouts logbook table (with sport filter pills) and a sport-breakdown donut. Headline: *"Workouts, logged."*

## Files touched
- `apps/web/src/app/workouts/page.tsx` — wrap existing JSX in `<div className="classic-workouts">`, append `<div className="atelier-workouts">`.
- `apps/web/src/components/workouts/atelier/WorkoutsHero.tsx` *(new)* — KPI row.
- `apps/web/src/components/workouts/atelier/Logbook.tsx` *(new)* — sortable table with sport filter pills.
- `apps/web/src/components/workouts/atelier/SportDonut.tsx` *(new)* — sport-breakdown donut + legend.
- `apps/web/src/app/theme.css` — append `.atelier-workouts *` selectors.

## Architectural decisions

- **Decision: Atelier window is 28 days** (mockup says "vs. prior 28d" repeatedly). Use `getWorkoutsRange(28d ago, today)` for KPI calculations, and pass the same set to the logbook + donut. Avoid double-fetching.
- **Decision: filter pills are client-side state**, so `Logbook.tsx` is `"use client"`. KPI row and donut are server components. Server component renders `<Logbook>` with `rows` prop.
- **Decision: donut palette uses `@/lib/sport-color.ts`** (existing). One palette for both classic and atelier. Confirm it exposes color-by-sport; if not, use a small inline lookup.
- **Decision: KPI deltas computed server-side from prior 28-day window.** Need a second `getWorkoutsRange(56d, 28d)` fetch. Two range queries; cheap.
- **Decision: cardiac-drift card and Zone2Tracker are NOT in Atelier.** Mockup shows logbook + donut only. Keep classic-only.

## Implementation steps

1. **`workouts/page.tsx`** — extend data loads:
   ```ts
   import { getWorkoutsRange } from "@/lib/db";
   const today = new Date().toISOString().slice(0, 10);
   const d28 = isoNDaysAgo(28);
   const d56 = isoNDaysAgo(56);
   const cur28 = getWorkoutsRange(d28, today);
   const prev28 = getWorkoutsRange(d56, d28);
   ```

2. **`WorkoutsHero.tsx`** *(new)* — props: `cur: WorkoutRow[]`, `prev: WorkoutRow[]`. Compute KPIs (with deltas vs prev):
   - Volume: `cur.length`
   - Intensity: `mean(cur.strain)`
   - Duration: `mean(cur.duration_sec) / 60` minutes
   - Max HR avg: `mean(cur.max_hr)`
   Render headline + 4 cards per mockup lines 295–365. Plate header Roman I.

3. **`Logbook.tsx`** *(new, `"use client"`)* — props: `rows: WorkoutRow[]`. Compute sport counts. Render filter pills (`All / Running / Cycling / …`) — pills derived from distinct `rows.sport`. Selected pill state via `useState`. Render table with columns Date · Sport tag · Duration · Strain · Avg HR · Max HR · Distance · kcal. Roman index per row in mono. Plate "Plate Nº 02".

4. **`SportDonut.tsx`** *(new)* — props: `rows: WorkoutRow[]`. Group counts by sport. Render donut: cumulative arc segments via SVG `<path>` with arc commands. Color per sport from `sport-color.ts` (or inline lookup). Legend on right with Roman numerals. Plate "Plate Nº 03".

5. **`workouts/page.tsx`** — wrap existing JSX in `<div className="classic-workouts">`. Append:
   ```tsx
   <div className="atelier-workouts">
     <WorkoutsHero cur={cur28} prev={prev28} />
     <div className="atelier-workouts-row-2">
       <Logbook rows={cur28} />
       <SportDonut rows={cur28} />
     </div>
   </div>
   ```

6. **`theme.css`** — append `.atelier-workouts`, `.atelier-workouts-row-2` (CSS grid 2-col, ~60/40 split per mockup), and per-component selectors. Pill styles per mockup line 347. Active pill = coral fill, white text. Scope all under `:root[data-theme="atelier"]`.

## Code structure (skeletons)

```tsx
// SportDonut.tsx — arc segments
type Slice = { sport: string; count: number; color: string };
const total = slices.reduce((a, s) => a + s.count, 0);
let acc = 0;
const arcs = slices.map((s) => {
  const start = (acc / total) * 2 * Math.PI;
  acc += s.count;
  const end = (acc / total) * 2 * Math.PI;
  // Convert to <path d="M cx cy L x1 y1 A r r 0 large 1 x2 y2 Z"/>.
  // Inner cutout: render two arcs (outer + inner) for donut effect.
  return { d, color: s.color };
});
```

```tsx
// Logbook.tsx — filter pills
const [sport, setSport] = useState<string>("All");
const filtered = sport === "All" ? rows : rows.filter((r) => r.sport === sport);
const sports = useMemo(() => {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.sport ?? "Other", (counts.get(r.sport ?? "Other") ?? 0) + 1);
  return [["All", rows.length] as const, ...counts];
}, [rows]);
```

## Patterns to follow
- DB reads: `getWorkoutsRange(start, end)` for date-bounded windows.
- Color lookup via existing `@/lib/sport-color.ts` if it exposes per-sport colors; otherwise inline lookup with `Running → coral, Cycling → mustard, Strength → olive, Yoga → ink-mute, Other → ink-faint`.
- Atelier classes prefixed `atelier-workouts-*`; CSS scoped under `:root[data-theme="atelier"]`.
- `Logbook` is `"use client"` for filter state; other Atelier components stay server-rendered.
- No new npm deps; donut is hand-rolled SVG.

## Acceptance criteria (from issue)
- [ ] `<div className="atelier-workouts">` parallel to classic; classic untouched.
- [ ] Logbook + sport donut render with real workout data over the last 28 days.
- [ ] Atelier Zero tokens applied.
- [ ] Real data only; no hard-coded counts.

## Verification
- `npm run build` clean.
- whoop-dev up → `/workouts` classic unchanged.
- Atelier mode: KPI row matches `cur28` derivations; logbook table count matches the volume KPI; donut slices sum to volume.
- agent-browser screenshot of atelier `/workouts`; compare to `mockup-workouts.html`.

## Out of scope (explicit)
- No edits to classic workouts components (`SportFrequencyChart`, `WorkoutZoneChart`, `WorkoutDistanceChart`, `Zone2Tracker`, `CardiacDriftCard`, classic table).
- No new analytics modules.
- No new DB queries beyond `getWorkoutsRange` (already exported).
- No infinite-scroll or pagination — 28-day window only.
- No new npm deps.
