/**
 * Personal goals (`/goals`, flag `GOALS_PAGE=1`).
 *
 * Pure computation: no DB, no `Date.now()`, no runtime timezone. The page
 * reads one bounded, user-scoped range of `daily_summary` rows (the last
 * `GOALS_WINDOW_DAYS` days), and this module evaluates the user's goals
 * against them. Goal targets live only in the browser (localStorage), so
 * `parseStoredGoals` is the trust boundary for whatever is stored there:
 * anything malformed falls back to the defaults, field by field.
 *
 * ## Weeks
 *
 * Every goal is weekly. Weeks start on `weekStart` (0 = Sunday … 6 =
 * Saturday); the app has no week-start setting yet, so the page passes
 * Monday. All date math is on `YYYY-MM-DD` strings through UTC, so a DST
 * change inside a week can never make it 6 or 8 days long or shift a row
 * into the wrong week — the caller resolves "today" in the user's zone.
 *
 * ## Status (current week)
 *
 * - Count/sum goals (workouts, weekly strain, recovery days) are **met** as
 *   soon as the target is reached, **on track** while the running total keeps
 *   pace with the days elapsed, otherwise **behind**. A recovery-days goal
 *   that can no longer be reached this week is behind regardless of pace.
 * - Average goals (sleep hours, sleep performance, resting HR) can't be
 *   "met" until the week is over, so the current week is **on track** when
 *   the average so far meets the target and **behind** when it doesn't.
 * - No data in the current week → **no data**.
 *
 * ## Streaks
 *
 * A streak counts consecutive weeks met. Completed weeks are judged on their
 * full data; an average needs `MIN_AVG_DAYS` days with a reading or the week
 * counts as "no data" (not met — the strap was off, so the goal wasn't
 * shown to be met). The current week extends a streak only once it is met,
 * and never breaks it while it is still in progress. Weeks only partly inside
 * the read window are left out, so streaks cover at most the window.
 */

export const GOALS_WINDOW_DAYS = 90;
/** A completed week needs this many readings for an average goal to count. */
export const MIN_AVG_DAYS = 3;
export const GOALS_STORAGE_KEY = "whoop.goals.v1";
export const GOALS_STORAGE_VERSION = 1;
export const DEFAULT_WEEK_START = 1; // Monday

/** The subset of `DailySummaryRow` the goals need. */
export type GoalDayRow = {
  date: string;
  recovery_score: number | null;
  resting_hr: number | null;
  sleep_hours: number | null;
  sleep_performance: number | null;
  day_strain: number | null;
  workouts_count: number | null;
};

export type GoalKind =
  | "sleepHours"
  | "sleepPerformance"
  | "recoveryDays"
  | "workouts"
  | "weeklyStrain"
  | "restingHr";

export const GOAL_KINDS: readonly GoalKind[] = [
  "sleepHours",
  "sleepPerformance",
  "recoveryDays",
  "workouts",
  "weeklyStrain",
  "restingHr",
];

type Range = { min: number; max: number; step: number };

export type GoalSpec = {
  kind: GoalKind;
  label: string;
  /** How the weekly value is aggregated. */
  aggregate: "avg" | "sum" | "count";
  /** Higher is better unless "atMost". */
  direction: "atLeast" | "atMost";
  unit: string;
  target: Range;
  /** Recovery-days only: how many days a week must clear the threshold. */
  days?: Range;
};

export const GOAL_SPECS: Record<GoalKind, GoalSpec> = {
  sleepHours: {
    kind: "sleepHours",
    label: "Average sleep",
    aggregate: "avg",
    direction: "atLeast",
    unit: "h",
    target: { min: 4, max: 12, step: 0.25 },
  },
  sleepPerformance: {
    kind: "sleepPerformance",
    label: "Sleep performance",
    aggregate: "avg",
    direction: "atLeast",
    unit: "%",
    target: { min: 50, max: 100, step: 1 },
  },
  recoveryDays: {
    kind: "recoveryDays",
    label: "Recovery days",
    aggregate: "count",
    direction: "atLeast",
    unit: "%",
    target: { min: 1, max: 99, step: 1 },
    days: { min: 1, max: 7, step: 1 },
  },
  workouts: {
    kind: "workouts",
    label: "Workouts",
    aggregate: "sum",
    direction: "atLeast",
    unit: "",
    target: { min: 1, max: 14, step: 1 },
  },
  weeklyStrain: {
    kind: "weeklyStrain",
    label: "Weekly strain",
    aggregate: "sum",
    direction: "atLeast",
    unit: "",
    target: { min: 10, max: 147, step: 1 },
  },
  restingHr: {
    kind: "restingHr",
    label: "Resting heart rate",
    aggregate: "avg",
    direction: "atMost",
    unit: "bpm",
    target: { min: 30, max: 100, step: 1 },
  },
};

export type GoalSetting = { enabled: boolean; target: number; days?: number };
export type GoalConfig = Record<GoalKind, GoalSetting>;

export function defaultGoalConfig(): GoalConfig {
  return {
    sleepHours: { enabled: true, target: 7.5 },
    sleepPerformance: { enabled: true, target: 85 },
    recoveryDays: { enabled: true, target: 67, days: 4 },
    workouts: { enabled: true, target: 3 },
    weeklyStrain: { enabled: false, target: 70 },
    restingHr: { enabled: false, target: 60 },
  };
}

// ---------------------------------------------------------------------------
// Storage (the trust boundary)

/** Valid when finite, inside [min, max] and on the step grid from `min`. */
export function isValidValue(v: unknown, r: Range): v is number {
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  if (v < r.min || v > r.max) return false;
  const steps = (v - r.min) / r.step;
  return Math.abs(steps - Math.round(steps)) < 1e-9;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse whatever is stored under `GOALS_STORAGE_KEY`. Never throws. A missing,
 * unparsable or wrong-version payload yields the defaults; within a valid
 * payload each goal is validated on its own, so one bad field only resets
 * that goal. Unknown keys are dropped.
 */
export function parseStoredGoals(raw: string | null | undefined): GoalConfig {
  const defaults = defaultGoalConfig();
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 4096) return defaults;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (!isPlainObject(parsed) || parsed.version !== GOALS_STORAGE_VERSION) return defaults;
  const goals = parsed.goals;
  if (!isPlainObject(goals)) return defaults;
  const out = defaultGoalConfig();
  for (const kind of GOAL_KINDS) {
    if (!Object.prototype.hasOwnProperty.call(goals, kind)) continue;
    const g = goals[kind];
    const spec = GOAL_SPECS[kind];
    if (!isPlainObject(g) || typeof g.enabled !== "boolean" || !isValidValue(g.target, spec.target)) continue;
    if (spec.days) {
      if (!isValidValue(g.days, spec.days)) continue;
      out[kind] = { enabled: g.enabled, target: g.target, days: g.days };
    } else {
      out[kind] = { enabled: g.enabled, target: g.target };
    }
  }
  return out;
}

/** Serialize a config; only valid settings are written (others become defaults). */
export function serializeGoals(config: GoalConfig): string {
  const clean = parseStoredGoals(JSON.stringify({ version: GOALS_STORAGE_VERSION, goals: config }));
  return JSON.stringify({ version: GOALS_STORAGE_VERSION, goals: clean });
}

// ---------------------------------------------------------------------------
// Dates

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Shift a `YYYY-MM-DD` date through UTC — immune to DST and the host zone. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function normalizeWeekStart(ws: unknown): number {
  return typeof ws === "number" && Number.isInteger(ws) && ws >= 0 && ws <= 6 ? ws : DEFAULT_WEEK_START;
}

/** First day of the week containing `date`. */
export function startOfWeek(date: string, weekStart: number = DEFAULT_WEEK_START): string {
  const ws = normalizeWeekStart(weekStart);
  return addDays(date, -((dayOfWeek(date) - ws + 7) % 7));
}

/** First date of the bounded read: `GOALS_WINDOW_DAYS` days ending today. */
export function goalsWindowStart(today: string): string {
  return addDays(today, -(GOALS_WINDOW_DAYS - 1));
}

// ---------------------------------------------------------------------------
// Evaluation

export type GoalStatus = "met" | "onTrack" | "behind" | "noData";

/** One week of one goal. */
export type GoalWeek = {
  start: string;
  end: string;
  /** Aggregated value (average, sum or count); null when no readings. */
  value: number | null;
  /** Days in the week that had a reading for this goal's metric. */
  daysWithData: number;
  met: boolean;
  /** Completed week with too little data to judge. */
  noData: boolean;
};

export type GoalProgress = {
  kind: GoalKind;
  spec: GoalSpec;
  setting: GoalSetting;
  status: GoalStatus;
  /** 0..1 toward the target for the current week. */
  progress: number;
  current: GoalWeek;
  /** Days elapsed in the current week, including today (1..7). */
  daysElapsed: number;
  /** Consecutive weeks met, ending this week (if met) or last week. */
  currentStreak: number;
  bestStreak: number;
  /** Completed weeks inside the window, oldest first, then the current week. */
  weeks: GoalWeek[];
};

function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The day's reading for this goal's metric, or null. */
function metricValue(kind: GoalKind, row: GoalDayRow, setting: GoalSetting): number | null {
  switch (kind) {
    case "sleepHours": {
      // daily_summary stores light+deep+rem; a sleep row without stages
      // comes through as 0, which is "no reading", not "slept 0 hours".
      const h = num(row.sleep_hours);
      return h !== null && h > 0 ? h : null;
    }
    case "sleepPerformance":
      return num(row.sleep_performance);
    case "restingHr": {
      const r = num(row.resting_hr);
      return r !== null && r > 0 ? r : null;
    }
    case "weeklyStrain":
      return num(row.day_strain);
    case "workouts": {
      const w = num(row.workouts_count);
      return w !== null && w >= 0 ? w : null;
    }
    case "recoveryDays": {
      const r = num(row.recovery_score);
      if (r === null) return null;
      return r >= setting.target ? 1 : 0;
    }
  }
}

function weekTarget(spec: GoalSpec, setting: GoalSetting): number {
  return spec.kind === "recoveryDays" ? (setting.days ?? 1) : setting.target;
}

function meets(spec: GoalSpec, setting: GoalSetting, value: number | null): boolean {
  if (value === null) return false;
  const t = weekTarget(spec, setting);
  return spec.direction === "atMost" ? value <= t : value >= t;
}

function aggregateWeek(
  spec: GoalSpec,
  setting: GoalSetting,
  byDate: Map<string, GoalDayRow>,
  start: string,
  end: string,
  completed: boolean,
): GoalWeek {
  const values: number[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const row = byDate.get(d);
    if (!row) continue;
    const v = metricValue(spec.kind, row, setting);
    if (v !== null) values.push(v);
  }
  const n = values.length;
  let value: number | null = null;
  if (n > 0) {
    const sum = values.reduce((a, b) => a + b, 0);
    value = spec.aggregate === "avg" ? sum / n : sum;
  }
  const insufficient = spec.aggregate === "avg" ? n < (completed ? MIN_AVG_DAYS : 1) : n === 0;
  return {
    start,
    end,
    value,
    daysWithData: n,
    met: !insufficient && meets(spec, setting, value),
    noData: insufficient,
  };
}

function progressToward(spec: GoalSpec, setting: GoalSetting, value: number | null): number {
  if (value === null) return 0;
  const t = weekTarget(spec, setting);
  const p = spec.direction === "atMost" ? (value <= 0 ? 0 : t / value) : t <= 0 ? 1 : value / t;
  return Math.max(0, Math.min(1, p));
}

function currentStatus(
  spec: GoalSpec,
  setting: GoalSetting,
  week: GoalWeek,
  daysElapsed: number,
): GoalStatus {
  if (week.daysWithData === 0 || week.value === null) return "noData";
  if (spec.aggregate === "avg") {
    if (!meets(spec, setting, week.value)) return "behind";
    // An average is only final once the week is over.
    return daysElapsed >= 7 && week.daysWithData >= MIN_AVG_DAYS ? "met" : "onTrack";
  }
  const t = weekTarget(spec, setting);
  if (week.value >= t) return "met";
  if (spec.kind === "recoveryDays" && week.value + (7 - daysElapsed) < t) return "behind";
  // Small epsilon so 3 workouts × 2/7 days elapsed = 0.857… still reads as on pace.
  return week.value + 1e-9 >= (t * daysElapsed) / 7 ? "onTrack" : "behind";
}

export type EvaluateGoalsInput = {
  rows: readonly GoalDayRow[];
  today: string;
  config: GoalConfig;
  weekStart?: number;
};

/**
 * Evaluate every enabled goal. Rows outside the window, rows with invalid
 * dates, and rows after `today` are ignored; duplicate dates keep the last.
 * Returns [] for an invalid `today`.
 */
export function evaluateGoals({ rows, today, config, weekStart }: EvaluateGoalsInput): GoalProgress[] {
  if (!isIsoDate(today)) return [];
  const ws = normalizeWeekStart(weekStart);
  const windowStart = goalsWindowStart(today);
  const byDate = new Map<string, GoalDayRow>();
  for (const r of rows) {
    if (!r || !isIsoDate(r.date) || r.date < windowStart || r.date > today) continue;
    byDate.set(r.date, r);
  }

  const currentStart = startOfWeek(today, ws);
  const daysElapsed = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${currentStart}T00:00:00Z`)) / 86_400_000,
  ) + 1;

  // Completed weeks wholly inside the window, oldest first.
  const completedStarts: string[] = [];
  for (let s = addDays(currentStart, -7); s >= windowStart; s = addDays(s, -7)) completedStarts.unshift(s);

  const out: GoalProgress[] = [];
  for (const kind of GOAL_KINDS) {
    const setting = config[kind];
    if (!setting?.enabled) continue;
    const spec = GOAL_SPECS[kind];
    const past = completedStarts.map((s) => aggregateWeek(spec, setting, byDate, s, addDays(s, 6), true));
    const current = aggregateWeek(spec, setting, byDate, currentStart, today, false);
    const status = currentStatus(spec, setting, current, daysElapsed);
    current.met = status === "met";
    const weeks = [...past, current];

    let best = 0;
    let run = 0;
    for (const w of weeks) {
      if (w.met) {
        run += 1;
        best = Math.max(best, run);
      } else if (w !== current) {
        run = 0;
      }
    }
    // `run` now ends at the current week (met) or at last week (in progress).
    out.push({
      kind,
      spec,
      setting,
      status,
      progress: progressToward(spec, setting, current.value),
      current,
      daysElapsed,
      currentStreak: run,
      bestStreak: best,
      weeks,
    });
  }
  return out;
}
