# Spike A — Report

**Date:** 2026-04-22
**Repo:** `~/Documents/code/scratch-whoop-spike-a/` (not committed, not inside `whoop-dashboard`)
**Tracking issue:** georgenijo/whoop-dashboard#52

## What I built

Next.js 15 App Router (actually **Next.js 16.2.4** — see deviation note below) + Tailwind v4 + Recharts 3.8, with the Whoop+ design system's `colors_and_type.css` and `styles.css` imported verbatim.

Four components wired with hard-coded data:

1. **RecoveryRing** (`src/components/RecoveryRing.tsx`) — inline SVG, Catmull-Rom helper from `ui_kits/dashboard/Metrics.jsx::RecoveryHero`. Teal gradient, Gaussian-blur glow filter, progress end-dot with drop-shadow.
2. **KPIStack** (`src/components/KPICard.tsx`) — 4 cards with inline-SVG micro-sparklines, ported from `Metrics.jsx::KPI + MicroSpark`.
3. **Recovery trend — kit version** (`RecoveryTrendSvg.tsx`) — inline SVG with Catmull-Rom → cubic bezier, lifted verbatim from `Metrics.jsx::RecoveryTrend`. **Reference.**
4. **Recovery trend — Recharts version** (`RecoveryTrendRecharts.tsx`) — Recharts `<AreaChart>` with `type="monotone"` and matching `<linearGradient>` fills. **Test subject.**
5. **AIInsight** (`AIInsight.tsx`) — violet-glow card, pulsing 8px dot, ported from `Coach.jsx::AIInsight`.

Side-by-side Recharts-vs-kit-SVG is wired directly into the page in a 2-column grid so the comparison is in-place — no need to open the kit `index.html` in a separate tab for A/B.

## Screenshot (headless Chrome, 1400×1400, 2026-04-22)

`spike-screenshots/full.png` (saved alongside this report).

## Visual comparison — Recovery trend

| Criterion | Kit (inline SVG) | Recharts | Verdict |
|---|---|---|---|
| Curve shape (peaks/valleys) | Catmull-Rom spline | `type="monotone"` cubic | **Very close** — both pass through all 30 data points with similar tension |
| Line weight | `strokeWidth={1.5}` + `vectorEffect="non-scaling-stroke"` → crisp 1.5px regardless of zoom | `strokeWidth={1.5}` rendered in CSS px → scales with container | **Recharts line visibly thicker**; needs `strokeWidth={1.0}` or `{1.25}` to match |
| Gradient area fill | `<linearGradient>` 0→1 vertical, 0.35 → 0 opacity | Identical gradient def | **Indistinguishable** |
| Gradient stroke | 0.00aa88 → 0x00d4aa horizontal | Identical gradient def | **Indistinguishable** |
| End-dot with drop-shadow | Manual `<circle>` with `drop-shadow(0 0 3px)` filter | `activeDot` prop doesn't support filter; would need custom dot component | **Recharts needs a custom dot** to match the kit's glow end-dot |
| Zone divider lines (33 / 66) | `<line>` with dashed subtle stroke | `<ReferenceLine y=...>` with same dash | **Indistinguishable** |
| Responsiveness | Fixed 100×100 viewBox + `preserveAspectRatio="none"` | `ResponsiveContainer` with client-only mount | Both fluid; Recharts requires `useEffect` gate to dodge SSR -1-dim warning |

### Other components

- **RecoveryRing**: inline SVG copy — pixel-matched.
- **KPIStack**: inline SVG micro-spark copy — pixel-matched.
- **AIInsight**: pure HTML + kit CSS — pixel-matched.

Ring + KPI + AI card are all static markup with no chart-library involvement, so there was never framework risk there. The real question the spike answers is whether Recharts is close enough on the 12 time-series charts that we'd otherwise hand-code in inline SVG.

## Verdict

**Recharts close, acceptable — with two known tuning items.**

Framework fit is confirmed. Next.js 15 (App Router) + Tailwind v4 + Recharts is a workable stack for the rebuild. Port effort is low: components are ~50–80 LOC each and the kit CSS works verbatim.

For the 12 time-series charts (recovery, HRV, RHR, sleep duration, sleep stages, sleep performance, daily strain, workout HR zones, ANS, rebound, strain-recovery scatter, cardiac drift, etc.), Recharts is the right choice over inline SVG — visual fidelity is acceptable after:

1. Tune `strokeWidth` down to **1.0 or 1.25** (from the kit's 1.5) to compensate for the absence of `vectorEffect="non-scaling-stroke"`.
2. Use a **custom dot component** (not `activeDot`) when the end-dot needs a glow / drop-shadow filter, since Recharts' default `activeDot` prop doesn't pass through SVG filters.

For the **recovery ring** and **sleep HR ribbon**, keep **inline SVG** as decided in the plan — they aren't charts, they're hero visualizations, and Recharts offers nothing there.

## Deviations from plan

- **Next.js 16.2.4** installed (not 15). `create-next-app@latest` now resolves to 16.x. Phase 1 Next.js scaffold issue (#56) should either (a) pin `next@15` explicitly if the plan's version discipline matters, or (b) accept 16.x as the new latest stable. 16 uses App Router by default and the APIs used in the spike are unchanged.
- **Tailwind v4** (not 3). Default from `create-next-app`. Migration tokens + kit CSS import cleanly. No rewrite needed.
- **SSR + Recharts**: Recharts `ResponsiveContainer` needs a measurable parent DOM; during SSR both dims are 0 and the chart draws -1/-1 and logs a warning. Fixed with a `useEffect(() => setMounted(true), [])` gate in `RecoveryTrendRecharts.tsx` so the chart mounts only post-hydration. This is the standard Recharts + App Router pattern; it should go in a `<ChartFrame>` wrapper component in the rebuild to avoid repeating the pattern at 12 chart sites.
- **Kit CSS nested @imports**: Tailwind v4 + Turbopack require all `@import` statements at the top of the entry CSS. The kit's `colors_and_type.css` and `styles.css` each have an `@import url(...)` inside them; when globals.css imports those, PostCSS inlines the nested imports past the leading rules and errors. Worked around by stripping both nested imports from the spike's copies (`src/app/colors_and_type.css`, `src/app/kit.css`) and hoisting the Geist font import to the top of `globals.css`. Phase 1 should apply the same hoisting when copying the kit CSS into `web/`.

## Recommended Phase 1 action items (for issue #56)

- [ ] Pin `next@15` explicitly, or update plan to accept 16.x.
- [ ] Wrap Recharts in a `<ChartFrame mountOnClient>` helper to avoid the SSR -1 warning repeating 12 times.
- [ ] Set a house `strokeWidth={1.0}` (or `1.25`) for all Recharts line/area series.
- [ ] Build a reusable `<GlowEndDot color=...>` custom dot component for chart end-dots.
- [ ] Copy `colors_and_type.css` + `styles.css` into `web/src/app/` with nested `@import`s stripped and hoisted to `globals.css`.

## Success criteria check

- [x] All 4 components render without errors at `http://localhost:3000`
- [x] Side-by-side screenshot comparison documented
- [x] Verdict: **Recharts close, acceptable** (with minor tuning)
