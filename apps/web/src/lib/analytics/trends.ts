import "server-only";

// Shared analytics primitives for trend charts. Mirrors the inline impls in
// `components/charts/TrendChart.tsx` and `components/charts/HRVTrend.tsx` so
// the iOS API routes can compute the same series server-side without
// re-implementing the math (or dragging client-only React modules into a
// Server-Component / route context).
//
// The web charts keep their inline copies for now — they are part of the
// client bundles and pulling them out is a refactor for a future PR.

/**
 * Trailing-window rolling mean over a possibly-null series. The value at
 * index `i` is the mean of `values[i - window + 1 .. i]`, ignoring nulls and
 * non-finite numbers. Returns `null` at positions where every value in the
 * trailing window is null/non-finite.
 *
 * Matches `rollingMean` in `TrendChart.tsx` exactly.
 */
export function rollingMean(
  values: (number | null)[],
  window: number,
): (number | null)[] {
  return values.map((_, i) => {
    const slice = values
      .slice(Math.max(0, i - (window - 1)), i + 1)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (slice.length === 0) return null;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/**
 * Trailing-window rolling mean and population standard deviation. The window
 * must contain at least `minPeriods` valid samples (default 14) for the
 * statistics to be reported, mirroring the σ-band gating in `HRVTrend.tsx`.
 *
 * Matches `rollingMeanStd` in `HRVTrend.tsx` exactly.
 */
export function rollingMeanStd(
  values: (number | null)[],
  window: number,
  minPeriods = 14,
): { mean: (number | null)[]; std: (number | null)[] } {
  const mean: (number | null)[] = new Array(values.length).fill(null);
  const std: (number | null)[] = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const slice = values
      .slice(Math.max(0, i - (window - 1)), i + 1)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (slice.length < minPeriods) continue;
    const m = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance =
      slice.reduce((a, b) => a + (b - m) ** 2, 0) / slice.length;
    mean[i] = m;
    std[i] = Math.sqrt(variance);
  }
  return { mean, std };
}

export type HRVAnomalyPoint = {
  date: string;
  hrv: number | null;
};

export type HRVAnomaly = {
  date: string;
  baseline_ms: number;
  pct_below: number;
};

/**
 * Detect HRV anomalies. A day is flagged when it has finite HRV AND the
 * rolling baseline+std is defined (≥`minPeriods` valid samples in the
 * trailing window) AND `hrv < mean - sigma*std`. Caller can additionally
 * require a `pctThreshold` relative drop (e.g. ≥15%) by passing `pctThreshold`.
 *
 * Mirrors the `HRVTrend.tsx` σ-band detector. The defaults match the web
 * component: window=30, sigma=1.5. `pctThreshold` is an additive guard for
 * cases where σ is very small and a tiny absolute drop crosses the σ-band
 * without being clinically meaningful.
 */
export function detectHRVAnomalies(
  points: HRVAnomalyPoint[],
  opts: { window?: number; sigma?: number; pctThreshold?: number; minPeriods?: number } = {},
): HRVAnomaly[] {
  const window = opts.window ?? 30;
  const sigma = opts.sigma ?? 1.5;
  const minPeriods = opts.minPeriods ?? 14;
  const pctThreshold = opts.pctThreshold ?? null;

  const series = points.map((p) => p.hrv);
  const { mean, std } = rollingMeanStd(series, window, minPeriods);

  const out: HRVAnomaly[] = [];
  for (let i = 0; i < points.length; i++) {
    const hrv = points[i].hrv;
    if (hrv == null || !Number.isFinite(hrv)) continue;
    const m = mean[i];
    const s = std[i];
    if (m == null || s == null || s === 0) continue;
    const sigmaFlag = hrv < m - sigma * s;
    const pctBelow = ((m - hrv) / m) * 100;
    const pctFlag = pctThreshold != null && pctBelow / 100 >= pctThreshold;
    if (!sigmaFlag && !pctFlag) continue;
    out.push({ date: points[i].date, baseline_ms: m, pct_below: pctBelow });
  }
  return out;
}
