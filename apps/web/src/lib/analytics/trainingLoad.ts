// Training-load EWMA shared by the TSB chart (components/charts/TSBCurve) and
// the strain target (lib/analytics/strainTarget). Pure — safe for client and
// server bundles.

/** Chronic training load span (days) — "fitness". */
export const CTL_SPAN = 42;
/** Acute training load span (days) — "fatigue". */
export const ATL_SPAN = 7;

export type LoadPoint = { date: string; ctl: number; atl: number; tsb: number };

/**
 * CTL/ATL/TSB over ascending date-keyed strain rows. Same semantics as the TSB
 * chart: seeded with the first row's strain, null strain counts as 0, and
 * missing dates are simply absent (no zero-fill).
 */
export function computeTrainingLoad(
  rows: { date: string; strain: number | null }[],
): LoadPoint[] {
  if (rows.length === 0) return [];
  const alphaCtl = 2 / (CTL_SPAN + 1);
  const alphaAtl = 2 / (ATL_SPAN + 1);
  const seed = rows[0].strain ?? 0;
  let ctl = seed;
  let atl = seed;
  const out: LoadPoint[] = [];
  for (const r of rows) {
    const s = r.strain ?? 0;
    ctl = alphaCtl * s + (1 - alphaCtl) * ctl;
    atl = alphaAtl * s + (1 - alphaAtl) * atl;
    out.push({ date: r.date, ctl, atl, tsb: ctl - atl });
  }
  return out;
}
