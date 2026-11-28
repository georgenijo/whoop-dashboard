/**
 * Data health: how complete the user's own Whoop data is (flag `DATA_HEALTH=1`).
 *
 * Pure: no DB, clock or network. The page passes already-fetched, user-scoped
 * rows (every reader goes through `forUser`) and "today" as a `YYYY-MM-DD`
 * string resolved in the user's timezone.
 *
 * Dates are calendar labels, not instants. Windows are built by shifting the
 * label with UTC arithmetic (`Date.UTC(y, m, d ± n)`), so a DST change can
 * never make a 30-day window 29 or 31 days long or skip/repeat a label.
 *
 * Per metric a day is:
 *   - "present"  — the metric has a usable (non-null) value that day;
 *   - "missing"  — no value, and the day is complete or past;
 *   - "pending"  — no value yet, but the day is today (recovery and sleep land
 *                  in the morning, strain accrues all day). Pending days are
 *                  excluded from coverage and gaps so a 7 a.m. visit is not
 *                  scolded for data that cannot exist yet;
 *   - "idle"     — activity metrics only (workouts): a rest day is not missing.
 *
 * Duplicate/overlap warnings reuse the existing dedup rule (`SLEEP_DEDUP_WHERE`
 * in `@/lib/db/sleep`): when two non-nap sleeps share a date, charts keep the
 * one with the longest `in_bed_ms`. Overlaps compare each sleep's own
 * `start_local`/`end_local` wall-clock strings.
 */

import { ACUTE_DAYS, ACUTE_MIN_DAYS, CHRONIC_DAYS, CHRONIC_MIN_DAYS } from "./acwr";
import { SLEEP_PLAN_LOOKBACK_DAYS, SLEEP_PLAN_MIN_NIGHTS } from "./sleepPlan";
import { MIN_PAIRED_DAYS, RECOVERY_DRIVERS_LOOKBACK_DAYS } from "./recoveryDrivers";
import { MIN_SCORED_DAYS } from "./weekly";

export const DATA_HEALTH_WINDOWS = [30, 90] as const;
export type DataHealthWindow = (typeof DATA_HEALTH_WINDOWS)[number];
export const DEFAULT_DATA_HEALTH_WINDOW: DataHealthWindow = 30;
/** Days the page reads: the widest window or the longest requirement lookback. */
export const DATA_HEALTH_FETCH_DAYS = Math.max(
  ...DATA_HEALTH_WINDOWS,
  RECOVERY_DRIVERS_LOOKBACK_DAYS,
  SLEEP_PLAN_LOOKBACK_DAYS,
  CHRONIC_DAYS,
);
/** At most this many duplicate/overlap warnings are listed (newest first). */
export const MAX_WARNINGS = 20;
/** Sync log sources that never pull data (token keepalive) are ignored. */
const NON_DATA_SYNC_SOURCES = new Set(["keepalive"]);

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------- inputs

export type HealthRecoveryRow = {
  date: string;
  recovery_score: number | null;
  hrv: number | null;
  rhr: number | null;
  spo2: number | null;
  skin_temp: number | null;
};

/** A non-nap sleep, NOT deduped (`getSleepRangeRaw`) so duplicates are visible. */
export type HealthSleepRow = {
  date: string;
  in_bed_ms: number | null;
  respiratory_rate: number | null;
  start_local: string | null;
  end_local: string | null;
};

export type HealthNapRow = {
  date: string;
  duration_ms: number | null;
  start_local: string | null;
  end_local: string | null;
};

export type HealthCycleRow = { date: string; strain: number | null };
export type HealthWorkoutRow = { date: string };

export type HealthSyncLog = {
  started_at: string;
  status: "ok" | "error";
  source: string | null;
  error_message: string | null;
};

/** Which flag-gated features are on, so requirements only name visible ones. */
export type DataHealthFeatures = {
  trainingLoad?: boolean;
  sleepPlan?: boolean;
  recoveryDrivers?: boolean;
  weeklyReview?: boolean;
};

export type DataHealthInput = {
  today: string;
  window: DataHealthWindow;
  recovery: readonly HealthRecoveryRow[];
  sleeps: readonly HealthSleepRow[];
  naps: readonly HealthNapRow[];
  cycles: readonly HealthCycleRow[];
  workouts: readonly HealthWorkoutRow[];
  syncLogs: readonly HealthSyncLog[];
  features?: DataHealthFeatures;
};

// ---------------------------------------------------------------- outputs

export type DayState = "present" | "missing" | "pending" | "idle";
export type DayCell = { date: string; state: DayState };
export type Gap = { start: string; end: string; days: number };

export type MetricKey =
  | "recovery"
  | "hrv"
  | "rhr"
  | "resp"
  | "skin_temp"
  | "spo2"
  | "sleep"
  | "strain"
  | "workouts";

export type MetricStatus =
  | "complete"
  | "good"
  | "patchy"
  | "poor"
  | "none"
  | "not-recorded"
  | "activity";

export type MetricCoverage = {
  key: MetricKey;
  label: string;
  group: "Recovery" | "Sleep" | "Strain";
  /** `daily` should exist every day; `activity` only on active days. */
  kind: "daily" | "activity";
  days: DayCell[];
  /** Days with a value. */
  present: number;
  /** Days that could have a value (window minus a pending today). */
  expected: number;
  /** Whole-number percentage, or null when nothing was expected. */
  pct: number | null;
  missing: number;
  longestGap: Gap | null;
  gapCount: number;
  /** Most recent date in the window with a value. */
  lastDate: string | null;
  status: MetricStatus;
  /** What a hole in this metric affects, in plain words. */
  affects: string;
};

export type DataWarningKind = "duplicate-sleep" | "overlap";

export type DataWarning = {
  kind: DataWarningKind;
  date: string;
  title: string;
  detail: string;
};

export type SyncSourceStatus = {
  source: string;
  label: string;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  /** Error message of the newest attempt, when that attempt failed. */
  failing: string | null;
};

export type Requirement = {
  key: "training-load" | "sleep-plan" | "recovery-drivers" | "weekly-review";
  feature: string;
  need: number;
  have: number;
  lookbackDays: number;
  met: boolean;
  explanation: string;
};

export type DataHealthSummary = {
  today: string;
  window: DataHealthWindow;
  start: string;
  dates: string[];
  metrics: MetricCoverage[];
  /** Coverage across recovery, sleep and strain (the three daily pillars). */
  overallPct: number | null;
  warnings: DataWarning[];
  warningTotal: number;
  sync: SyncSourceStatus[];
  /** Newest date with any recovery, sleep or strain row (all-time in input). */
  latestDataDate: string | null;
  requirements: Requirement[];
};

// ---------------------------------------------------------------- dates

export function isIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Shift a `YYYY-MM-DD` label by whole calendar days (DST-proof). */
export function shiftIsoDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Inclusive list of `n` consecutive dates ending at `end`. */
export function windowDates(end: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftIsoDate(end, i - (n - 1)));
}

export function parseWindow(raw: string | string[] | undefined): DataHealthWindow {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(v);
  return (DATA_HEALTH_WINDOWS as readonly number[]).includes(n)
    ? (n as DataHealthWindow)
    : DEFAULT_DATA_HEALTH_WINDOW;
}

function finite(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// ---------------------------------------------------------------- coverage

type MetricSpec = {
  key: MetricKey;
  label: string;
  group: MetricCoverage["group"];
  kind: MetricCoverage["kind"];
  /** Optional sensors: no value anywhere in the window = "not recorded". */
  optional?: boolean;
  affects: string;
  /** Dates with a usable value. */
  dates: (input: DataHealthInput) => Set<string>;
};

function datesWhere<T extends { date: string }>(rows: readonly T[], ok: (r: T) => boolean): Set<string> {
  const out = new Set<string>();
  for (const r of rows) if (typeof r.date === "string" && ok(r)) out.add(r.date);
  return out;
}

const METRICS: MetricSpec[] = [
  {
    key: "recovery",
    label: "Recovery score",
    group: "Recovery",
    kind: "daily",
    affects: "Missing recovery days leave holes in the Recovery chart and thin out every baseline built on it.",
    dates: (i) => datesWhere(i.recovery, (r) => finite(r.recovery_score)),
  },
  {
    key: "hrv",
    label: "HRV",
    group: "Recovery",
    kind: "daily",
    affects: "HRV gaps weaken the illness and overtraining signals, which compare today against your recent HRV.",
    dates: (i) => datesWhere(i.recovery, (r) => finite(r.hrv)),
  },
  {
    key: "rhr",
    label: "Resting HR",
    group: "Recovery",
    kind: "daily",
    affects: "Resting HR gaps weaken the illness signal's baseline.",
    dates: (i) => datesWhere(i.recovery, (r) => finite(r.rhr)),
  },
  {
    key: "resp",
    label: "Respiratory rate",
    group: "Sleep",
    kind: "daily",
    affects: "Respiratory rate is measured during sleep; gaps hide the respiratory-rate anomaly check.",
    dates: (i) => datesWhere(i.sleeps, (s) => finite(s.respiratory_rate)),
  },
  {
    key: "skin_temp",
    label: "Skin temperature",
    group: "Recovery",
    kind: "daily",
    optional: true,
    affects: "Skin temperature gaps hide the temperature-deviation card.",
    dates: (i) => datesWhere(i.recovery, (r) => finite(r.skin_temp)),
  },
  {
    key: "spo2",
    label: "Blood oxygen (SpO2)",
    group: "Recovery",
    kind: "daily",
    optional: true,
    affects: "SpO2 is informational; gaps only blank that day's reading.",
    dates: (i) => datesWhere(i.recovery, (r) => finite(r.spo2)),
  },
  {
    key: "sleep",
    label: "Sleep",
    group: "Sleep",
    kind: "daily",
    affects: "Missing nights skew sleep debt, consistency and the bedtime patterns.",
    dates: (i) => datesWhere(i.sleeps, (s) => finite(s.in_bed_ms) && s.in_bed_ms > 0),
  },
  {
    key: "strain",
    label: "Day strain",
    group: "Strain",
    kind: "daily",
    affects: "Missing strain days drag the training-load averages, which only count days with data.",
    dates: (i) => datesWhere(i.cycles, (c) => finite(c.strain)),
  },
  {
    key: "workouts",
    label: "Workouts",
    group: "Strain",
    kind: "activity",
    affects: "Rest days are not missing data; this row just shows which days had a logged workout.",
    dates: (i) => datesWhere(i.workouts, () => true),
  },
];

function statusFor(pct: number | null, present: number): MetricStatus {
  if (pct === null) return present > 0 ? "complete" : "none";
  if (pct >= 100) return "complete";
  if (pct >= 90) return "good";
  if (pct >= 60) return "patchy";
  if (pct > 0) return "poor";
  return "none";
}

function computeGaps(days: readonly DayCell[]): { longest: Gap | null; count: number } {
  let longest: Gap | null = null;
  let count = 0;
  let runStart = -1;
  const close = (endIdx: number) => {
    if (runStart < 0) return;
    count++;
    const len = endIdx - runStart + 1;
    // Ties go to the most recent gap (later runs replace equal-length ones).
    if (!longest || len >= longest.days) {
      longest = { start: days[runStart].date, end: days[endIdx].date, days: len };
    }
    runStart = -1;
  };
  days.forEach((d, i) => {
    if (d.state === "missing") {
      if (runStart < 0) runStart = i;
    } else {
      close(i - 1);
    }
  });
  close(days.length - 1);
  return { longest, count };
}

function coverageFor(spec: MetricSpec, input: DataHealthInput, dates: readonly string[]): MetricCoverage {
  const have = spec.dates(input);
  const today = input.today;
  const days: DayCell[] = dates.map((date) => {
    if (have.has(date)) return { date, state: "present" };
    if (spec.kind === "activity") return { date, state: "idle" };
    return { date, state: date === today ? "pending" : "missing" };
  });
  const present = days.filter((d) => d.state === "present").length;
  const lastDate = [...days].reverse().find((d) => d.state === "present")?.date ?? null;
  const base = {
    key: spec.key,
    label: spec.label,
    group: spec.group,
    kind: spec.kind,
    present,
    lastDate,
    affects: spec.affects,
  };

  if (spec.kind === "activity") {
    return {
      ...base,
      days,
      expected: days.length,
      pct: days.length ? Math.round((present / days.length) * 100) : null,
      missing: 0,
      longestGap: null,
      gapCount: 0,
      status: "activity",
    };
  }

  if (spec.optional && present === 0) {
    // The sensor/feature never reported in this window: not the user's fault,
    // so the strip is neutral instead of a wall of "missing".
    return {
      ...base,
      days: days.map((d) => ({ date: d.date, state: "idle" })),
      expected: 0,
      pct: null,
      missing: 0,
      longestGap: null,
      gapCount: 0,
      status: "not-recorded",
    };
  }

  const expected = days.filter((d) => d.state !== "pending").length;
  const missing = days.filter((d) => d.state === "missing").length;
  const pct = expected ? Math.round((present / expected) * 100) : null;
  const { longest, count } = computeGaps(days);
  return {
    ...base,
    days,
    expected,
    pct,
    missing,
    longestGap: longest,
    gapCount: count,
    status: statusFor(pct, present),
  };
}

// ---------------------------------------------------------------- warnings

/** Naive local wall-clock string → comparable ms (null when unparseable). */
function localMs(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(t) ? t : null;
}

export function formatDuration(ms: number | null): string {
  if (!finite(ms) || ms <= 0) return "0m";
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

function clockText(s: string | null): string {
  return s && s.length >= 16 ? s.slice(11, 16) : "?";
}

type Interval = { kind: "sleep" | "nap"; date: string; start: number; end: number; startText: string | null; endText: string | null };

function buildWarnings(input: DataHealthInput, startDate: string): DataWarning[] {
  const inWindow = (d: string) => d >= startDate && d <= input.today;
  const out: DataWarning[] = [];

  // 1. Two or more main sleeps filed on one date (dedup keeps the longest).
  const byDate = new Map<string, HealthSleepRow[]>();
  for (const s of input.sleeps) {
    if (!inWindow(s.date)) continue;
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }
  for (const [date, list] of byDate) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => (b.in_bed_ms ?? -1) - (a.in_bed_ms ?? -1));
    const kept = sorted[0];
    const others = sorted.slice(1).map((s) => formatDuration(s.in_bed_ms)).join(", ");
    out.push({
      kind: "duplicate-sleep",
      date,
      title: `${list.length} main sleeps on one day`,
      detail:
        `Charts and averages use the longest (${formatDuration(kept.in_bed_ms)}); ` +
        `the other${list.length > 2 ? "s" : ""} (${others}) still reach the Coach and your export.`,
    });
  }

  // 2. Overlapping intervals across main sleeps and naps.
  const intervals: Interval[] = [];
  const push = (kind: Interval["kind"], date: string, startText: string | null, endText: string | null) => {
    if (!inWindow(date)) return;
    const start = localMs(startText);
    const end = localMs(endText);
    if (start === null || end === null || end <= start) return;
    intervals.push({ kind, date, start, end, startText, endText });
  };
  for (const s of input.sleeps) push("sleep", s.date, s.start_local, s.end_local);
  for (const n of input.naps) push("nap", n.date, n.start_local, n.end_local);
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 0; i < intervals.length; i++) {
    const a = intervals[i];
    for (let j = i + 1; j < intervals.length && intervals[j].start < a.end; j++) {
      const b = intervals[j];
      const overlapMs = Math.min(a.end, b.end) - b.start;
      if (overlapMs < 60_000) continue;
      const kinds =
        a.kind === "nap" && b.kind === "nap"
          ? "Two naps overlap"
          : a.kind === "sleep" && b.kind === "sleep"
            ? "Two sleeps overlap"
            : "Nap overlaps main sleep";
      const describe = (x: Interval) => `${x.kind === "nap" ? "nap" : "sleep"} ${clockText(x.startText)}–${clockText(x.endText)}`;
      out.push({
        kind: "overlap",
        date: b.date > a.date ? b.date : a.date,
        title: kinds,
        detail:
          `${describe(a)} and ${describe(b)} share ${formatDuration(overlapMs)}. ` +
          (a.kind !== b.kind
            ? "Naps are kept out of nightly sleep totals, so this does not double-count, but the nap may be a mis-split of the night."
            : "Totals that add these together would double-count the shared time."),
      });
    }
  }

  return out.sort((x, y) => (x.date === y.date ? x.kind.localeCompare(y.kind) : y.date.localeCompare(x.date)));
}

// ---------------------------------------------------------------- sync

const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual sync",
  webhook: "Real-time updates",
  onboarding: "First sync",
  coach: "Coach-triggered sync",
};

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function syncSourceKey(source: string | null): string {
  return source && source.trim() ? source.trim() : "manual";
}

export function summarizeSync(logs: readonly HealthSyncLog[]): SyncSourceStatus[] {
  const by = new Map<string, { okMs: number | null; okAt: string | null; errMs: number | null; errAt: string | null; latestMs: number; latestErr: string | null }>();
  for (const l of logs) {
    const key = syncSourceKey(l.source);
    if (NON_DATA_SYNC_SOURCES.has(key)) continue;
    const ms = Date.parse(l.started_at);
    if (!Number.isFinite(ms)) continue;
    const cur = by.get(key) ?? { okMs: null, okAt: null, errMs: null, errAt: null, latestMs: -Infinity, latestErr: null };
    if (l.status === "ok" && (cur.okMs === null || ms > cur.okMs)) {
      cur.okMs = ms;
      cur.okAt = new Date(ms).toISOString();
    }
    if (l.status === "error" && (cur.errMs === null || ms > cur.errMs)) {
      cur.errMs = ms;
      cur.errAt = new Date(ms).toISOString();
    }
    if (ms >= cur.latestMs) {
      cur.latestMs = ms;
      cur.latestErr = l.status === "error" ? truncate(l.error_message || "Sync failed", 140) : null;
    }
    by.set(key, cur);
  }
  return [...by.entries()]
    .sort(([, a], [, b]) => b.latestMs - a.latestMs)
    .map(([source, v]) => ({
      source,
      label: SOURCE_LABELS[source] ?? source,
      lastOkAt: v.okAt,
      lastErrorAt: v.errAt,
      failing: v.latestErr,
    }));
}

// ---------------------------------------------------------------- requirements

function countInLookback(dates: Set<string>, today: string, lookback: number): number {
  const start = shiftIsoDate(today, -(lookback - 1));
  let n = 0;
  for (const d of dates) if (d >= start && d <= today) n++;
  return n;
}

function buildRequirements(input: DataHealthInput): Requirement[] {
  const f = input.features ?? {};
  const strain = METRICS.find((m) => m.key === "strain")!.dates(input);
  const sleep = METRICS.find((m) => m.key === "sleep")!.dates(input);
  const recovery = METRICS.find((m) => m.key === "recovery")!.dates(input);
  const out: Requirement[] = [];

  if (f.trainingLoad) {
    const have = countInLookback(strain, input.today, CHRONIC_DAYS);
    const acute = countInLookback(strain, input.today, ACUTE_DAYS);
    const met = have >= CHRONIC_MIN_DAYS && acute >= ACUTE_MIN_DAYS;
    out.push({
      key: "training-load",
      feature: "Training Load ratio",
      need: CHRONIC_MIN_DAYS,
      have,
      lookbackDays: CHRONIC_DAYS,
      met,
      explanation: met
        ? `Has the ${CHRONIC_MIN_DAYS} strain days in ${CHRONIC_DAYS} (and ${ACUTE_MIN_DAYS} in the last ${ACUTE_DAYS}) it needs.`
        : `Needs ${CHRONIC_MIN_DAYS} strain days in the last ${CHRONIC_DAYS} and ${ACUTE_MIN_DAYS} in the last ${ACUTE_DAYS} (you have ${acute}); until then it shows "building baseline".`,
    });
  }
  if (f.sleepPlan) {
    const have = countInLookback(sleep, input.today, SLEEP_PLAN_LOOKBACK_DAYS);
    const met = have >= SLEEP_PLAN_MIN_NIGHTS;
    out.push({
      key: "sleep-plan",
      feature: "Tonight's sleep plan",
      need: SLEEP_PLAN_MIN_NIGHTS,
      have,
      lookbackDays: SLEEP_PLAN_LOOKBACK_DAYS,
      met,
      explanation: met
        ? `Has at least ${SLEEP_PLAN_MIN_NIGHTS} recorded nights in the last ${SLEEP_PLAN_LOOKBACK_DAYS} days.`
        : `Needs ${SLEEP_PLAN_MIN_NIGHTS} recorded nights in the last ${SLEEP_PLAN_LOOKBACK_DAYS} days before it can suggest a bedtime.`,
    });
  }
  if (f.recoveryDrivers) {
    const have = countInLookback(recovery, input.today, RECOVERY_DRIVERS_LOOKBACK_DAYS);
    const met = have >= MIN_PAIRED_DAYS;
    out.push({
      key: "recovery-drivers",
      feature: "Recovery drivers",
      need: MIN_PAIRED_DAYS,
      have,
      lookbackDays: RECOVERY_DRIVERS_LOOKBACK_DAYS,
      met,
      explanation: met
        ? `Has the ${MIN_PAIRED_DAYS} scored recovery days in ${RECOVERY_DRIVERS_LOOKBACK_DAYS} it needs; more days make each driver more reliable.`
        : `Needs ${MIN_PAIRED_DAYS} scored recovery days in the last ${RECOVERY_DRIVERS_LOOKBACK_DAYS} before it ranks what moves your recovery.`,
    });
  }
  if (f.weeklyReview) {
    const have = countInLookback(recovery, input.today, 7);
    const met = have >= MIN_SCORED_DAYS;
    out.push({
      key: "weekly-review",
      feature: "Weekly review",
      need: MIN_SCORED_DAYS,
      have,
      lookbackDays: 7,
      met,
      explanation: met
        ? `This week has enough scored recovery days (${MIN_SCORED_DAYS}+) to compare.`
        : `A week needs ${MIN_SCORED_DAYS} scored recovery days to be compared; the last 7 days have ${have}.`,
    });
  }
  return out;
}

// ---------------------------------------------------------------- main

export function buildDataHealth(input: DataHealthInput): DataHealthSummary {
  if (!isIsoDate(input.today)) throw new Error(`buildDataHealth: bad today "${input.today}"`);
  const dates = windowDates(input.today, input.window);
  const start = dates[0];
  const metrics = METRICS.map((spec) => coverageFor(spec, input, dates));

  const pillars = metrics.filter((m) => m.key === "recovery" || m.key === "sleep" || m.key === "strain");
  const expected = pillars.reduce((s, m) => s + m.expected, 0);
  const present = pillars.reduce((s, m) => s + m.present, 0);
  const overallPct = expected ? Math.round((present / expected) * 100) : null;

  const allWarnings = buildWarnings(input, start);

  let latestDataDate: string | null = null;
  for (const r of [...input.recovery, ...input.sleeps, ...input.cycles]) {
    if (typeof r.date === "string" && r.date <= input.today && (!latestDataDate || r.date > latestDataDate)) {
      latestDataDate = r.date;
    }
  }

  return {
    today: input.today,
    window: input.window,
    start,
    dates,
    metrics,
    overallPct,
    warnings: allWarnings.slice(0, MAX_WARNINGS),
    warningTotal: allWarnings.length,
    sync: summarizeSync(input.syncLogs),
    latestDataDate,
    requirements: buildRequirements(input),
  };
}

/** Whole calendar days between two `YYYY-MM-DD` labels (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}
