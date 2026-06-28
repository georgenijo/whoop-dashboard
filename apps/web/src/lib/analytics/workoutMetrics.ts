// Derived workout metrics computed from a downsampled HR stream (issue #425).
//
// Pure functions — no DB, no fs, no `server-only` — so they can be unit-tested
// in isolation and reused by the workout-detail page (T4) on either the server
// or (if ever needed) the client. All metrics degrade gracefully: too little
// signal returns `null` rather than throwing, so the caller can hide the card.
//
// Cardiac drift is NOT re-implemented here — reuse `computeCardiacDrift` from
// `./cardiacDrift` (it operates on WorkoutRow[] across sessions, not a single
// stream). These functions cover the single-session HR-stream metrics.

/**
 * Downsampled per-second HR stream, as stored in `workouts.hr_series` and sent
 * by iOS. `bpm[i]` is the heart rate at
 * `start_offset_sec + i * interval_sec` seconds into the workout. `null`
 * entries mark gaps (sensor dropout) and are skipped by every metric.
 */
export type HrSeries = {
  interval_sec: number;
  start_offset_sec: number;
  bpm: (number | null)[];
};

/** Narrow + sanity-check an untrusted value into an HrSeries, or null. */
export function parseHrSeries(value: unknown): HrSeries | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const interval = v.interval_sec;
  const offset = v.start_offset_sec;
  const bpm = v.bpm;
  if (typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0) {
    return null;
  }
  if (typeof offset !== "number" || !Number.isFinite(offset) || offset < 0) {
    return null;
  }
  if (!Array.isArray(bpm) || bpm.length === 0) return null;
  const cleaned: (number | null)[] = bpm.map((b) =>
    typeof b === "number" && Number.isFinite(b) && b > 0 ? b : null,
  );
  return { interval_sec: interval, start_offset_sec: offset, bpm: cleaned };
}

/**
 * Recovery rate: the change in HR over the 60 seconds following the session's
 * final sustained peak. Returns `bpm[peak + 60s] - bpm[peak]`, so a **negative**
 * value means HR dropped after the peak (good recovery); positive means it kept
 * climbing. `null` when there's no usable peak or the 60s window runs past the
 * end of the stream.
 *
 * "Final sustained peak" = the last sample whose value equals the stream max,
 * which is robust to a single early spike followed by a hard finishing effort.
 */
export function recoveryRate(hrSeries: HrSeries | null): number | null {
  if (!hrSeries) return null;
  const { bpm, interval_sec } = hrSeries;
  let max = -Infinity;
  for (const b of bpm) {
    if (b != null && b > max) max = b;
  }
  if (!Number.isFinite(max)) return null;

  // Last index achieving the max — the "final" peak.
  let peakIdx = -1;
  for (let i = bpm.length - 1; i >= 0; i--) {
    if (bpm[i] === max) {
      peakIdx = i;
      break;
    }
  }
  if (peakIdx < 0) return null;

  const stepsFor60s = Math.round(60 / interval_sec);
  if (stepsFor60s <= 0) return null;
  const afterIdx = peakIdx + stepsFor60s;
  if (afterIdx >= bpm.length) return null;
  const after = bpm[afterIdx];
  const peak = bpm[peakIdx];
  if (after == null || peak == null) return null;
  return after - peak;
}

/**
 * Seconds spent at or above `pct` of `maxHr`. `pct` is a fraction (0.9 = 90%).
 * Each in-range sample contributes `interval_sec` seconds. Returns `null` when
 * `maxHr` is unusable; `0` is a legitimate result (never went that high).
 */
export function timeAbovePct(
  hrSeries: HrSeries | null,
  maxHr: number | null | undefined,
  pct: number,
): number | null {
  if (!hrSeries) return null;
  if (typeof maxHr !== "number" || !Number.isFinite(maxHr) || maxHr <= 0) {
    return null;
  }
  if (!Number.isFinite(pct) || pct <= 0) return null;
  const threshold = maxHr * pct;
  let samples = 0;
  for (const b of hrSeries.bpm) {
    if (b != null && b >= threshold) samples += 1;
  }
  return samples * hrSeries.interval_sec;
}

/**
 * Banister TRIMP (training impulse) from the HR stream. For each valid sample:
 *   Δt(min) × HRr × 0.64 · e^(1.92 · HRr),  HRr = (HR − rest) / (max − rest)
 * (the male coefficients). `rest` is the 30-day resting HR, `max` the profile
 * max HR. HRr is clamped to [0, 1] so a sample below rest or above max can't
 * push the exponential term to absurd values. Returns `null` when the
 * rest/max bounds are invalid; `0`+ otherwise.
 */
export function trimp(
  hrSeries: HrSeries | null,
  bounds: { rest: number; max: number },
): number | null {
  if (!hrSeries) return null;
  const { rest, max } = bounds;
  if (
    typeof rest !== "number" ||
    typeof max !== "number" ||
    !Number.isFinite(rest) ||
    !Number.isFinite(max) ||
    max <= rest
  ) {
    return null;
  }
  const dtMin = hrSeries.interval_sec / 60;
  let total = 0;
  for (const b of hrSeries.bpm) {
    if (b == null) continue;
    let hrr = (b - rest) / (max - rest);
    if (hrr < 0) hrr = 0;
    if (hrr > 1) hrr = 1;
    total += dtMin * hrr * 0.64 * Math.exp(1.92 * hrr);
  }
  return total;
}
