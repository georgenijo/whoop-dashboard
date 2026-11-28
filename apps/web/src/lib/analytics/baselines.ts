/**
 * "Your baselines" (flag `BASELINES_PAGE=1`): what is normal for YOU, per
 * metric. Pure computation over already-fetched, user-scoped rows — no I/O,
 * no clock (the caller passes `today`), no user id (the caller's readers are
 * the tenant boundary).
 *
 * For each metric:
 *   - **Baseline** = median of the metric's daily values over the selected
 *     window (30 / 60 / 90 days ending today, inclusive). Median, not mean,
 *     so one sick night or a sensor glitch cannot drag it.
 *   - **Normal band** = 25th–75th percentile of the same values (linear
 *     interpolation, `percentile` from recoveryOutlook.ts) — the middle half
 *     of your days. Values exactly on an edge count as within the band.
 *   - **Building baseline** when the window has fewer than
 *     `MIN_BASELINE_DAYS` values; nothing else is computed then.
 *   - **Latest value** = the newest value no older than `LATEST_MAX_AGE_DAYS`
 *     and where it sits: below / within / above the band.
 *   - **Baseline trend** = today's baseline minus the baseline of the same-
 *     length window that ended `TREND_LOOKBACK_DAYS` days ago (also needs
 *     `MIN_BASELINE_DAYS` values). A change smaller than
 *     max(metric minimum change, `STEADY_IQR_FRACTION` × today's band width)
 *     is "steady".
 *
 * Dates are local YYYY-MM-DD strings compared lexically and shifted with UTC
 * arithmetic (`shiftDate`), so a DST change never adds or drops a day. Rows
 * with a malformed date or a non-finite value are ignored; a repeated date
 * keeps the LAST row (readers return ascending order).
 *
 * Day strain for today is still accumulating, so the strain series ends
 * yesterday — today's partial strain would read as "below normal" every
 * morning.
 */
import type { RecoveryRow } from "@/lib/db/recovery";
import type { SleepRow } from "@/lib/db/sleep";
import type { CycleRow } from "@/lib/db/strain";
import { shiftDate } from "@/lib/range";
import { asleepHours, percentile } from "./recoveryOutlook";

export const BASELINE_WINDOWS = [30, 60, 90] as const;
export type BaselineWindow = (typeof BASELINE_WINDOWS)[number];
export const DEFAULT_BASELINE_WINDOW: BaselineWindow = 30;

/** Values needed in a window before a baseline is shown. */
export const MIN_BASELINE_DAYS = 14;
/** The band is the 25th–75th percentile (the middle half of your days). */
export const BAND_LOW_PCT = 0.25;
export const BAND_HIGH_PCT = 0.75;
/** The baseline trend compares against the window that ended this long ago. */
export const TREND_LOOKBACK_DAYS = 60;
/** A latest value older than this is not shown as "today". */
export const LATEST_MAX_AGE_DAYS = 3;
/** Baseline moves under this fraction of the band width read as steady. */
export const STEADY_IQR_FRACTION = 0.25;

export function parseBaselineWindow(raw: string | undefined): BaselineWindow {
  const n = Number(raw);
  return (BASELINE_WINDOWS as readonly number[]).includes(n)
    ? (n as BaselineWindow)
    : DEFAULT_BASELINE_WINDOW;
}

/**
 * First date the page must read: the start of the trend comparison window.
 * One extra day back because the strain series ends yesterday.
 */
export function baselineReadStart(today: string, windowDays: BaselineWindow): string {
  return shiftDate(today, -windowDays - TREND_LOOKBACK_DAYS);
}

export type BaselineMetricKey =
  | "hrv"
  | "rhr"
  | "respiratory_rate"
  | "skin_temp"
  | "sleep_hours"
  | "sleep_performance"
  | "recovery"
  | "strain";

/** Which way is good: "higher" (HRV), "lower" (RHR), or "neutral". */
export type Direction = "higher" | "lower" | "neutral";

export type BaselineInputs = {
  recovery: ReadonlyArray<Pick<RecoveryRow, "date" | "recovery_score" | "hrv" | "rhr" | "skin_temp">>;
  sleep: ReadonlyArray<
    Pick<SleepRow, "date" | "light_ms" | "deep_ms" | "rem_ms" | "performance" | "respiratory_rate">
  >;
  cycles: ReadonlyArray<Pick<CycleRow, "date" | "strain">>;
};

type MetricDef = {
  key: BaselineMetricKey;
  label: string;
  unit: string;
  decimals: number;
  direction: Direction;
  /** Smallest baseline move that counts as a change, in the metric's unit. */
  minChange: number;
  /** Skin temperature is read as a deviation from your own baseline. */
  showAsDeviation?: boolean;
  /** Strain: today's value is still accumulating; the series ends yesterday. */
  excludeToday?: boolean;
  about: string;
  below: string;
  above: string;
  pick: (i: BaselineInputs) => { date: string; value: number | null | undefined }[];
};

const fromRecovery =
  (f: (r: BaselineInputs["recovery"][number]) => number | null) => (i: BaselineInputs) =>
    i.recovery.map((r) => ({ date: r.date, value: f(r) }));

const fromSleep =
  (f: (r: BaselineInputs["sleep"][number]) => number | null) => (i: BaselineInputs) =>
    i.sleep.map((r) => ({ date: r.date, value: f(r) }));

export const BASELINE_METRICS: readonly MetricDef[] = [
  {
    key: "hrv",
    label: "HRV",
    unit: "ms",
    decimals: 0,
    direction: "higher",
    minChange: 1,
    about: "Heart-rate variability during sleep; higher usually means a more rested nervous system.",
    below: "Lower than usual often follows hard training, short or late sleep, alcohol, stress or getting sick.",
    above: "Higher than usual is generally a sign your body has recovered well.",
    pick: fromRecovery((r) => r.hrv),
  },
  {
    key: "rhr",
    label: "Resting heart rate",
    unit: "bpm",
    decimals: 0,
    direction: "lower",
    minChange: 0.5,
    about: "Your sleeping resting heart rate; it tends to drift down as fitness improves.",
    below: "Lower than usual is generally a sign of good recovery.",
    above: "Higher than usual often follows hard training, alcohol, heat, dehydration or the start of an illness.",
    pick: fromRecovery((r) => r.rhr),
  },
  {
    key: "respiratory_rate",
    label: "Respiratory rate",
    unit: "rpm",
    decimals: 1,
    direction: "neutral",
    minChange: 0.1,
    about: "Breaths per minute while asleep; for most people it barely moves night to night.",
    below: "A little lower than usual is rarely meaningful on its own.",
    above: "A rise above your normal range is one of the earliest signs of illness or heavy strain — worth watching if it lasts.",
    pick: fromSleep((r) => r.respiratory_rate),
  },
  {
    key: "skin_temp",
    label: "Skin temperature",
    unit: "°C",
    decimals: 1,
    direction: "neutral",
    minChange: 0.1,
    showAsDeviation: true,
    about: "Overnight skin temperature, read as a difference from your own baseline rather than an absolute number.",
    below: "Cooler than usual is often just a colder room or bedding change.",
    above: "Warmer than usual can come from a warm room, alcohol, the menstrual cycle or an oncoming illness.",
    pick: fromRecovery((r) => r.skin_temp),
  },
  {
    key: "sleep_hours",
    label: "Sleep duration",
    unit: "h",
    decimals: 1,
    direction: "higher",
    minChange: 0.1,
    about: "Time actually asleep (light + deep + REM), not time in bed.",
    below: "Shorter than your normal; a run of these builds sleep debt.",
    above: "Longer than your normal — often catch-up sleep after a hard or short stretch.",
    pick: fromSleep((r) => asleepHours(r as SleepRow)),
  },
  {
    key: "sleep_performance",
    label: "Sleep performance",
    unit: "%",
    decimals: 0,
    direction: "higher",
    minChange: 1,
    about: "How much of Whoop's estimated sleep need you actually got.",
    below: "You met less of your sleep need than usual.",
    above: "You met more of your sleep need than usual.",
    pick: fromSleep((r) => r.performance),
  },
  {
    key: "recovery",
    label: "Recovery",
    unit: "%",
    decimals: 0,
    direction: "higher",
    minChange: 1,
    about: "Whoop's daily readiness score, built from HRV, resting heart rate, sleep and respiratory rate.",
    below: "A below-normal day for you — a lighter session or an earlier night usually pays off.",
    above: "An above-normal day for you — a good day to train hard if you planned to.",
    pick: fromRecovery((r) => r.recovery_score),
  },
  {
    key: "strain",
    label: "Day strain",
    unit: "",
    decimals: 1,
    direction: "neutral",
    minChange: 0.2,
    excludeToday: true,
    about: "Whoop's 0–21 cardiovascular load for a whole day; shown for yesterday because today is still in progress.",
    below: "A lighter day than you usually have.",
    above: "A harder day than you usually have — expect recovery to need more sleep tonight.",
    pick: (i) => i.cycles.map((r) => ({ date: r.date, value: r.strain })),
  },
];

export type BandPosition = "below" | "within" | "above";
export type TrendDirection = "rising" | "falling" | "steady";

export type BaselinePoint = { date: string; value: number };

export type MetricBaseline = {
  key: BaselineMetricKey;
  label: string;
  unit: string;
  decimals: number;
  direction: Direction;
  showAsDeviation: boolean;
  about: string;
  /** The metric's window, inclusive (strain's ends yesterday). */
  start: string;
  end: string;
  /** Values found in the selected window (the sample size). */
  days: number;
  status: "ready" | "building";
  /** Present only when status is "ready". */
  baseline: number | null;
  bandLow: number | null;
  bandHigh: number | null;
  /** Window values, oldest first (for the sparkline). */
  series: BaselinePoint[];
  latest: (BaselinePoint & { position: BandPosition | null; delta: number | null }) | null;
  trend: {
    previous: number;
    change: number;
    direction: TrendDirection;
    /** "better" / "worse" for metrics with a good direction, else "neutral". */
    meaning: "better" | "worse" | "neutral";
  } | null;
  /** Plain-language "what this means" sentence. */
  summary: string;
};

export type BaselinesResult = {
  today: string;
  windowDays: BaselineWindow;
  start: string;
  metrics: MetricBaseline[];
  /** True when at least one metric has a baseline. */
  anyReady: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function median(sorted: number[]): number {
  return percentile(sorted, 0.5);
}

/** One finite value per valid date (last row wins), ascending by date. */
function cleanSeries(points: { date: string; value: number | null | undefined }[]): BaselinePoint[] {
  const byDate = new Map<string, number>();
  for (const p of points) {
    if (typeof p.date !== "string" || !DATE_RE.test(p.date)) continue;
    if (typeof p.value !== "number" || !Number.isFinite(p.value)) continue;
    byDate.set(p.date, p.value);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, value]) => ({ date, value }));
}

function inRange(points: BaselinePoint[], start: string, end: string): BaselinePoint[] {
  return points.filter((p) => p.date >= start && p.date <= end);
}

function sortedValues(points: BaselinePoint[]): number[] {
  return points.map((p) => p.value).sort((a, b) => a - b);
}

export function bandPosition(value: number, low: number, high: number): BandPosition {
  if (value < low) return "below";
  if (value > high) return "above";
  return "within";
}

export function formatMetricValue(value: number, decimals: number, signed = false): string {
  const rounded = Number(value.toFixed(decimals));
  // Avoid "-0" / "+-0" after rounding.
  const safe = Object.is(rounded, -0) ? 0 : rounded;
  const text = Math.abs(safe).toFixed(decimals);
  if (signed) return `${safe > 0 ? "+" : safe < 0 ? "−" : "±"}${text}`;
  return safe < 0 ? `−${text}` : text;
}

export function withUnit(text: string, unit: string): string {
  if (!unit) return text;
  return unit === "%" ? `${text}%` : `${text} ${unit}`;
}

function trendMeaning(direction: Direction, change: TrendDirection): "better" | "worse" | "neutral" {
  if (change === "steady" || direction === "neutral") return "neutral";
  const up = change === "rising";
  return (direction === "higher") === up ? "better" : "worse";
}

function buildSummary(def: MetricDef, m: Omit<MetricBaseline, "summary">): string {
  if (m.status === "building") {
    const need = MIN_BASELINE_DAYS - m.days;
    return `Building your baseline — ${m.days} of ${MIN_BASELINE_DAYS} days so far; ${need} more day${need === 1 ? "" : "s"} of data needed.`;
  }
  const parts: string[] = [];
  if (!m.latest || m.latest.position == null) {
    parts.push("No recent reading to compare with your normal range.");
  } else if (m.latest.position === "within") {
    parts.push("Within your normal range — a typical day for you.");
  } else {
    parts.push(m.latest.position === "below" ? def.below : def.above);
  }
  if (m.trend) {
    const span = `${TREND_LOOKBACK_DAYS} days ago`;
    if (m.trend.direction === "steady") {
      parts.push(`Your baseline is about the same as ${span}.`);
    } else {
      const amount = withUnit(formatMetricValue(Math.abs(m.trend.change), def.decimals), def.unit);
      const verb = m.trend.direction === "rising" ? "up" : "down";
      const tail =
        m.trend.meaning === "better"
          ? " — a positive long-term shift."
          : m.trend.meaning === "worse"
            ? " — worth a look at sleep, training load and stress."
            : ".";
      parts.push(`Your baseline is ${verb} ${amount} vs ${span}${tail}`);
    }
  } else {
    parts.push(`Not enough history yet to compare with ${TREND_LOOKBACK_DAYS} days ago.`);
  }
  return parts.join(" ");
}

function computeMetric(
  def: MetricDef,
  inputs: BaselineInputs,
  today: string,
  windowDays: BaselineWindow,
): MetricBaseline {
  const end = def.excludeToday ? shiftDate(today, -1) : today;
  const start = shiftDate(end, -(windowDays - 1));
  const all = inRange(cleanSeries(def.pick(inputs)), shiftDate(start, -TREND_LOOKBACK_DAYS), end);
  const series = inRange(all, start, end);
  const base = {
    key: def.key,
    label: def.label,
    unit: def.unit,
    decimals: def.decimals,
    direction: def.direction,
    showAsDeviation: def.showAsDeviation ?? false,
    about: def.about,
    start,
    end,
    days: series.length,
    series,
  };

  if (series.length < MIN_BASELINE_DAYS) {
    const m = {
      ...base,
      status: "building" as const,
      baseline: null,
      bandLow: null,
      bandHigh: null,
      latest: null,
      trend: null,
    };
    return { ...m, summary: buildSummary(def, m) };
  }

  const sorted = sortedValues(series);
  const baseline = median(sorted);
  const bandLow = percentile(sorted, BAND_LOW_PCT);
  const bandHigh = percentile(sorted, BAND_HIGH_PCT);

  const last = series[series.length - 1];
  const fresh = last.date >= shiftDate(end, -(LATEST_MAX_AGE_DAYS - 1));
  const latest = fresh
    ? { ...last, position: bandPosition(last.value, bandLow, bandHigh), delta: last.value - baseline }
    : null;

  const prevEnd = shiftDate(end, -TREND_LOOKBACK_DAYS);
  const prev = inRange(all, shiftDate(prevEnd, -(windowDays - 1)), prevEnd);
  let trend: MetricBaseline["trend"] = null;
  if (prev.length >= MIN_BASELINE_DAYS) {
    const previous = median(sortedValues(prev));
    const change = baseline - previous;
    const threshold = Math.max(def.minChange, STEADY_IQR_FRACTION * (bandHigh - bandLow));
    const direction: TrendDirection =
      Math.abs(change) < threshold ? "steady" : change > 0 ? "rising" : "falling";
    trend = { previous, change, direction, meaning: trendMeaning(def.direction, direction) };
  }

  const m = { ...base, status: "ready" as const, baseline, bandLow, bandHigh, latest, trend };
  return { ...m, summary: buildSummary(def, m) };
}

export function computeBaselines(
  inputs: BaselineInputs,
  today: string,
  windowDays: BaselineWindow,
): BaselinesResult {
  const metrics = BASELINE_METRICS.map((d) => computeMetric(d, inputs, today, windowDays));
  return {
    today,
    windowDays,
    start: shiftDate(today, -(windowDays - 1)),
    metrics,
    anyReady: metrics.some((m) => m.status === "ready"),
  };
}
