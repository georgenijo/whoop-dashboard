import "server-only";

import { createHash } from "node:crypto";
import type { Database as DB } from "better-sqlite3";
import { hasColumn, hasTable } from "./connection";
import { SLEEP_DEDUP_WHERE } from "./sleep";
import { forUser } from "./scoped";

export const MORNING_BRIEF_TTL_MS = 10 * 60 * 1000;

export const MORNING_METRIC_KEYS = [
  "sleep_duration",
  "sleep_performance",
  "recovery_score",
  "hrv",
  "resting_heart_rate",
  "strain",
  "steps",
] as const;

export type MorningMetricKey = (typeof MORNING_METRIC_KEYS)[number];
export type MorningMetricSource = "whoop" | "apple_health" | null;
export type MorningMetricStatus = "available" | "missing" | "stale" | "unavailable";
export type MorningBriefStatus = "ok" | "partial" | "unavailable";

export type MorningMetric = {
  value: number | null;
  unit: "h" | "%" | "ms" | "bpm" | "score" | "steps";
  source: MorningMetricSource;
  data_date: string | null;
  period_start: string | null;
  period_end: string | null;
  source_updated_at: string | null;
  ingested_at: string | null;
  status: MorningMetricStatus;
  partial: boolean;
};

export type MorningBrief = {
  schema_version: 1;
  generated_at: string;
  expires_at: string;
  timezone: string;
  requested_date: string;
  status: MorningBriefStatus;
  metrics: Record<MorningMetricKey, MorningMetric>;
};

export type MorningAccountBinding =
  | { kind: "account_subject"; value: string }
  | { kind: "email_sha256"; value: string };

export type MorningBriefFailure =
  | "invalid_configuration"
  | "database_unavailable"
  | "schema_invalid"
  | "account_unavailable"
  | "integration_unavailable"
  | null;

export type MorningBriefBuildResult = {
  brief: MorningBrief;
  failure: MorningBriefFailure;
};

export type BuildMorningBriefOptions = {
  userId: number;
  binding: MorningAccountBinding;
  now?: Date;
};

const METRIC_UNITS: Record<MorningMetricKey, MorningMetric["unit"]> = {
  sleep_duration: "h",
  sleep_performance: "%",
  recovery_score: "%",
  hrv: "ms",
  resting_heart_rate: "bpm",
  strain: "score",
  steps: "steps",
};

const REQUIRED_SCHEMA: Record<string, readonly string[]> = {
  users: ["id", "apple_sub", "email", "timezone"],
  integrations: ["user_id", "provider", "needs_reauth", "provider_user_id", "updated_at"],
  recovery: ["user_id", "date", "recovery_score", "hrv", "rhr", "raw"],
  sleep: [
    "user_id",
    "sleep_id",
    "date",
    "in_bed_ms",
    "light_ms",
    "deep_ms",
    "rem_ms",
    "performance",
    "nap",
    "raw",
  ],
  cycles: ["user_id", "date", "strain", "raw"],
  daily_steps: ["user_id", "date", "steps", "source", "updated_at"],
  whoop_cycle_steps: [
    "user_id",
    "cycle_id",
    "date",
    "cycle_start",
    "cycle_end",
    "step_count",
    "upstream_updated_at",
    "fetched_at",
  ],
};

type UserRow = {
  id: number;
  apple_sub: string | null;
  email: string | null;
  timezone: string | null;
};

type RecoveryRow = {
  date: string;
  recovery_score: number | null;
  hrv: number | null;
  rhr: number | null;
  source_updated_at: string | null;
};

type SleepRow = {
  date: string;
  light_ms: number | null;
  deep_ms: number | null;
  rem_ms: number | null;
  performance: number | null;
  period_start: string | null;
  period_end: string | null;
  source_updated_at: string | null;
};

type CycleRow = {
  date: string;
  strain: number | null;
  period_start: string | null;
  period_end: string | null;
  source_updated_at: string | null;
};

type WhoopStepsRow = {
  date: string;
  steps: number | null;
  cycle_start: string | null;
  cycle_end: string | null;
  upstream_updated_at: string | null;
  fetched_at: string | null;
};

type AppleStepsRow = {
  date: string;
  steps: number | null;
  updated_at: string | null;
};

type MetricCandidate = {
  value: number;
  source: Exclude<MorningMetricSource, null>;
  date: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  sourceUpdatedAt?: string | null;
  ingestedAt?: string | null;
  partial?: boolean;
};

type SnapshotResult =
  | { ok: true; timezone: string; metrics: MorningBrief["metrics"] }
  | { ok: false; failure: Exclude<MorningBriefFailure, "invalid_configuration" | "database_unavailable" | null>; timezone?: string };

function emptyMetric(key: MorningMetricKey, status: "missing" | "unavailable"): MorningMetric {
  return {
    value: null,
    unit: METRIC_UNITS[key],
    source: null,
    data_date: null,
    period_start: null,
    period_end: null,
    source_updated_at: null,
    ingested_at: null,
    status,
    partial: false,
  };
}

function emptyMetrics(status: "missing" | "unavailable"): MorningBrief["metrics"] {
  return Object.fromEntries(
    MORNING_METRIC_KEYS.map((key) => [key, emptyMetric(key, status)]),
  ) as MorningBrief["metrics"];
}

function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function dateInTimezone(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: "year" | "month" | "day") =>
    parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new Error("Unable to resolve requested date");
  return `${year}-${month}-${day}`;
}

function subtractDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Invalid requested date");
  parsed.setUTCDate(parsed.getUTCDate() - days);
  return parsed.toISOString().slice(0, 10);
}

function normalizeIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const naive = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(trimmed);
  const normalized = naive ? `${trimmed.replace(" ", "T")}Z` : trimmed;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function isBoundedNumber(
  value: number | null | undefined,
  min: number,
  max: number,
): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function isDataDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function metricFromCandidate(
  key: MorningMetricKey,
  candidate: MetricCandidate | null,
  requestedDate: string,
): MorningMetric {
  if (!candidate) return emptyMetric(key, "missing");
  return {
    value: candidate.value,
    unit: METRIC_UNITS[key],
    source: candidate.source,
    data_date: candidate.date,
    period_start: normalizeIso(candidate.periodStart),
    period_end: normalizeIso(candidate.periodEnd),
    source_updated_at: normalizeIso(candidate.sourceUpdatedAt),
    ingested_at: normalizeIso(candidate.ingestedAt),
    status: candidate.date === requestedDate ? "available" : "stale",
    partial: candidate.partial ?? false,
  };
}

function firstCandidate<T>(
  rows: T[],
  select: (row: T) => MetricCandidate | null,
): MetricCandidate | null {
  for (const row of rows) {
    const candidate = select(row);
    if (candidate && isDataDate(candidate.date)) return candidate;
  }
  return null;
}

export function normalizedEmailSha256(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");
}

function schemaIsCurrent(db: DB): boolean {
  return Object.entries(REQUIRED_SCHEMA).every(
    ([table, columns]) => hasTable(db, table) && columns.every((column) => hasColumn(db, table, column)),
  );
}

function resolveBoundUser(
  db: DB,
  userId: number,
  binding: MorningAccountBinding,
): UserRow | null {
  if (binding.kind === "account_subject") {
    const matches = db
      .prepare("SELECT id, apple_sub, email, timezone FROM users WHERE apple_sub = ?")
      .all(binding.value) as UserRow[];
    return matches.length === 1 && matches[0].id === userId ? matches[0] : null;
  }

  const matches = (db
    .prepare("SELECT id, apple_sub, email, timezone FROM users WHERE email IS NOT NULL")
    .all() as UserRow[]).filter(
      (row) => row.email !== null && normalizedEmailSha256(row.email) === binding.value,
    );
  return matches.length === 1 && matches[0].id === userId ? matches[0] : null;
}

function integrationIsActive(db: DB, userId: number): boolean {
  const rows = db
    .prepare(
      `SELECT needs_reauth, provider_user_id, updated_at
       FROM integrations
       WHERE user_id = ? AND provider = 'whoop'`,
    )
    .all(userId) as {
      needs_reauth: number;
      provider_user_id: string | null;
      updated_at: string | null;
    }[];
  if (rows.length !== 1) return false;
  const row = rows[0];
  return (
    row.needs_reauth === 0 &&
    typeof row.provider_user_id === "string" &&
    row.provider_user_id.trim().length > 0 &&
    normalizeIso(row.updated_at) !== null
  );
}

function selectMetrics(
  db: DB,
  userId: number,
  requestedDate: string,
): MorningBrief["metrics"] {
  const startDate = subtractDays(requestedDate, 7);
  const recovery = db
    .prepare(
      `SELECT date, recovery_score, hrv, rhr,
              CASE WHEN json_valid(raw) THEN json_extract(raw, '$.updated_at') END
                AS source_updated_at
       FROM recovery
       WHERE date BETWEEN ? AND ? AND user_id = ?
       ORDER BY date DESC`,
    )
    .all(startDate, requestedDate, userId) as RecoveryRow[];
  const sleep = db
    .prepare(
      `SELECT s.date, s.light_ms, s.deep_ms, s.rem_ms, s.performance,
              CASE WHEN json_valid(s.raw) THEN json_extract(s.raw, '$.start') END
                AS period_start,
              CASE WHEN json_valid(s.raw) THEN json_extract(s.raw, '$.end') END
                AS period_end,
              CASE WHEN json_valid(s.raw) THEN json_extract(s.raw, '$.updated_at') END
                AS source_updated_at
       FROM sleep s
       WHERE COALESCE(s.nap, 0) = 0
         AND s.date BETWEEN ? AND ?
         AND ${SLEEP_DEDUP_WHERE}
         AND s.user_id = ?
       ORDER BY s.date DESC`,
    )
    .all(startDate, requestedDate, userId) as SleepRow[];
  const cycles = db
    .prepare(
      `SELECT date, strain,
              CASE WHEN json_valid(raw) THEN json_extract(raw, '$.start') END
                AS period_start,
              CASE WHEN json_valid(raw) THEN json_extract(raw, '$.end') END
                AS period_end,
              CASE WHEN json_valid(raw) THEN json_extract(raw, '$.updated_at') END
                AS source_updated_at
       FROM cycles
       WHERE date BETWEEN ? AND ? AND user_id = ?
       ORDER BY date DESC`,
    )
    .all(startDate, requestedDate, userId) as CycleRow[];
  const whoopSteps = db
    .prepare(
      `SELECT date, step_count AS steps, cycle_start, cycle_end,
              upstream_updated_at, fetched_at
       FROM whoop_cycle_steps
       WHERE date BETWEEN ? AND ? AND step_count IS NOT NULL AND user_id = ?
       ORDER BY date DESC, cycle_start DESC, cycle_id DESC`,
    )
    .all(startDate, requestedDate, userId) as WhoopStepsRow[];
  const appleSteps = db
    .prepare(
      `SELECT date, steps, updated_at
       FROM daily_steps
       WHERE date BETWEEN ? AND ? AND source = 'apple_health' AND user_id = ?
       ORDER BY date DESC`,
    )
    .all(startDate, requestedDate, userId) as AppleStepsRow[];

  const sleepDuration = firstCandidate(sleep, (row) => {
    if (
      !isBoundedNumber(row.light_ms, 0, 86_400_000) ||
      !isBoundedNumber(row.deep_ms, 0, 86_400_000) ||
      !isBoundedNumber(row.rem_ms, 0, 86_400_000)
    ) {
      return null;
    }
    const hours = (row.light_ms + row.deep_ms + row.rem_ms) / 3_600_000;
    return isBoundedNumber(hours, 0, 24)
      ? {
          value: hours,
          source: "whoop",
          date: row.date,
          periodStart: row.period_start,
          periodEnd: row.period_end,
          sourceUpdatedAt: row.source_updated_at,
        }
      : null;
  });
  const sleepPerformance = firstCandidate(sleep, (row) =>
    isBoundedNumber(row.performance, 0, 100)
      ? {
          value: row.performance,
          source: "whoop",
          date: row.date,
          periodStart: row.period_start,
          periodEnd: row.period_end,
          sourceUpdatedAt: row.source_updated_at,
        }
      : null,
  );
  const recoveryScore = firstCandidate(recovery, (row) =>
    isBoundedNumber(row.recovery_score, 0, 100)
      ? {
          value: row.recovery_score,
          source: "whoop",
          date: row.date,
          sourceUpdatedAt: row.source_updated_at,
        }
      : null,
  );
  const hrv = firstCandidate(recovery, (row) =>
    isBoundedNumber(row.hrv, 0, 1_000)
      ? {
          value: row.hrv,
          source: "whoop",
          date: row.date,
          sourceUpdatedAt: row.source_updated_at,
        }
      : null,
  );
  const restingHeartRate = firstCandidate(recovery, (row) =>
    isBoundedNumber(row.rhr, 20, 250)
      ? {
          value: row.rhr,
          source: "whoop",
          date: row.date,
          sourceUpdatedAt: row.source_updated_at,
        }
      : null,
  );
  const strain = firstCandidate(cycles, (row) =>
    isBoundedNumber(row.strain, 0, 21)
      ? {
          value: row.strain,
          source: "whoop",
          date: row.date,
          periodStart: row.period_start,
          periodEnd: row.period_end,
          sourceUpdatedAt: row.source_updated_at,
        }
      : null,
  );

  const whoopStepCandidates = whoopSteps.flatMap((row): MetricCandidate[] =>
    isDataDate(row.date) &&
    typeof row.steps === "number" &&
    Number.isInteger(row.steps) &&
    isBoundedNumber(row.steps, 0, 200_000)
      ? [{
          value: row.steps,
          source: "whoop",
          date: row.date,
          periodStart: row.cycle_start,
          periodEnd: row.cycle_end,
          sourceUpdatedAt: row.upstream_updated_at,
          ingestedAt: row.fetched_at,
          partial: normalizeIso(row.cycle_end) === null,
        }]
      : [],
  );
  const appleStepCandidates = appleSteps.flatMap((row): MetricCandidate[] =>
    isDataDate(row.date) &&
    typeof row.steps === "number" &&
    Number.isInteger(row.steps) &&
    isBoundedNumber(row.steps, 0, 200_000)
      ? [{
          value: row.steps,
          source: "apple_health",
          date: row.date,
          ingestedAt: row.updated_at,
        }]
      : [],
  );
  const currentWhoop = whoopStepCandidates.find((row) => row.date === requestedDate);
  const currentApple = appleStepCandidates.find((row) => row.date === requestedDate);
  const latestSteps = [...whoopStepCandidates, ...appleStepCandidates].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    if (byDate !== 0) return byDate;
    return a.source === "whoop" ? -1 : 1;
  })[0] ?? null;
  const steps = currentWhoop ?? currentApple ?? latestSteps;

  return {
    sleep_duration: metricFromCandidate("sleep_duration", sleepDuration, requestedDate),
    sleep_performance: metricFromCandidate("sleep_performance", sleepPerformance, requestedDate),
    recovery_score: metricFromCandidate("recovery_score", recoveryScore, requestedDate),
    hrv: metricFromCandidate("hrv", hrv, requestedDate),
    resting_heart_rate: metricFromCandidate("resting_heart_rate", restingHeartRate, requestedDate),
    strain: metricFromCandidate("strain", strain, requestedDate),
    steps: metricFromCandidate("steps", steps, requestedDate),
  };
}

function snapshot(
  db: DB,
  userId: number,
  binding: MorningAccountBinding,
  now: Date,
): SnapshotResult {
  if (!schemaIsCurrent(db)) return { ok: false, failure: "schema_invalid" };
  const user = resolveBoundUser(db, userId, binding);
  if (!user) return { ok: false, failure: "account_unavailable" };
  const timezone = user.timezone?.trim() ?? "";
  if (!timezone || !isIanaTimezone(timezone)) {
    return { ok: false, failure: "account_unavailable" };
  }
  if (!integrationIsActive(db, userId)) {
    return { ok: false, failure: "integration_unavailable", timezone };
  }
  const requestedDate = dateInTimezone(now, timezone);
  return { ok: true, timezone, metrics: selectMetrics(db, userId, requestedDate) };
}

export function unavailableMorningBrief(now = new Date(), timezone = "UTC"): MorningBrief {
  const safeNow = Number.isFinite(now.getTime()) ? now : new Date(0);
  const safeTimezone = isIanaTimezone(timezone) ? timezone : "UTC";
  const generatedAt = safeNow.toISOString();
  return {
    schema_version: 1,
    generated_at: generatedAt,
    expires_at: new Date(safeNow.getTime() + MORNING_BRIEF_TTL_MS).toISOString(),
    timezone: safeTimezone,
    requested_date: dateInTimezone(safeNow, safeTimezone),
    status: "unavailable",
    metrics: emptyMetrics("unavailable"),
  };
}

export function buildMorningBrief(options: BuildMorningBriefOptions): MorningBriefBuildResult {
  const now = options.now ?? new Date();
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isSafeInteger(options.userId) ||
    options.userId <= 0 ||
    !options.binding.value.trim() ||
    (options.binding.kind === "email_sha256" &&
      !/^[a-f0-9]{64}$/.test(options.binding.value))
  ) {
    return {
      brief: unavailableMorningBrief(now),
      failure: "invalid_configuration",
    };
  }

  try {
    const result = forUser(options.userId).read((db, userId) =>
      db.transaction(() => snapshot(db, userId, options.binding, now))(),
    );
    if (!result) {
      return {
        brief: unavailableMorningBrief(now),
        failure: "database_unavailable",
      };
    }
    if (!result.ok) {
      return {
        brief: unavailableMorningBrief(now, result.timezone),
        failure: result.failure,
      };
    }

    const generatedAt = now.toISOString();
    const requestedDate = dateInTimezone(now, result.timezone);
    const complete = MORNING_METRIC_KEYS.every((key) => {
      const metric = result.metrics[key];
      return metric.status === "available" && !metric.partial;
    });
    return {
      brief: {
        schema_version: 1,
        generated_at: generatedAt,
        expires_at: new Date(now.getTime() + MORNING_BRIEF_TTL_MS).toISOString(),
        timezone: result.timezone,
        requested_date: requestedDate,
        status: complete ? "ok" : "partial",
        metrics: result.metrics,
      },
      failure: null,
    };
  } catch {
    return {
      brief: unavailableMorningBrief(now),
      failure: "schema_invalid",
    };
  }
}
