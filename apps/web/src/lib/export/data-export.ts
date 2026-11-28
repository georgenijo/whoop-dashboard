// Pure logic for the user-owned data export (`GET /api/export`, flag
// DATA_EXPORT=1). No DB, no network, no `server-only` — everything here is a
// function of its arguments so it can be unit-tested directly. The route
// supplies the rows (from the existing user-scoped `@/lib/db` readers) and the
// user's "today".
//
// Contract (documented in docs/data-export.md — keep in sync):
//   * kinds: recovery | sleep | workouts | cycles | steps | all
//   * formats: csv | json
//   * range: from/to YYYY-MM-DD, inclusive; default = last 90 days ending today
//     (user's tz); max span 400 days; from <= to.
//   * per-dataset row cap MAX_EXPORT_ROWS; overflow is truncated and flagged.
//   * column order per dataset is fixed by EXPORT_COLUMNS and is part of the
//     contract — append new columns at the end, never reorder.

export const EXPORT_VERSION = 1;
export const DEFAULT_RANGE_DAYS = 90;
export const MAX_RANGE_DAYS = 400;
/** Per-dataset safety cap. 400 days × a heavy 5 workouts/day = 2000, so this
 *  only trips on pathological data; it exists so one request can't build an
 *  unbounded response. */
export const MAX_EXPORT_ROWS = 5000;

export const EXPORT_DATASETS = ["recovery", "sleep", "workouts", "cycles", "steps"] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];
export type ExportKind = ExportDataset | "all";
export type ExportFormat = "csv" | "json";

export type ExportCell = string | number | boolean | null | undefined;
export type ExportRow = Record<string, ExportCell>;

/**
 * Allow-list of exported columns per dataset, in output order. Anything a
 * reader returns that is not listed here is dropped by `projectRows`, so a
 * reader growing a new column (or an internal id) can never leak into an
 * export by accident. Deliberately absent: user_id, workout/cycle/sleep ids,
 * raw JSON, tokens, anything from integrations / chat / logs.
 */
export const EXPORT_COLUMNS: Record<ExportDataset, readonly string[]> = {
  recovery: ["date", "recovery_score", "hrv", "rhr", "spo2", "skin_temp"],
  sleep: [
    "date",
    "nap",
    "start_local",
    "end_local",
    "in_bed_ms",
    "light_ms",
    "deep_ms",
    "rem_ms",
    "awake_ms",
    "sleep_need_ms",
    "performance",
    "efficiency",
    "consistency",
    "disturbances",
    // Renamed from the reader's `cycles` (sleep-cycle count) so it can't be
    // confused with the `cycles` (daily strain) dataset in the combined CSV.
    "sleep_cycles",
    "respiratory_rate",
  ],
  workouts: [
    "date",
    "start_utc",
    "end_utc",
    "sport",
    "duration_sec",
    "strain",
    "kilojoule",
    "avg_hr",
    "max_hr",
    "distance_m",
    "zone_0_ms",
    "zone_1_ms",
    "zone_2_ms",
    "zone_3_ms",
    "zone_4_ms",
    "zone_5_ms",
  ],
  cycles: ["date", "strain", "kilojoule", "avg_hr", "max_hr"],
  steps: ["date", "steps", "source"],
};

/** Column order for the combined `kind=all` CSV: `dataset` first, then the
 *  union of every dataset's columns in first-seen order. */
export const ALL_CSV_COLUMNS: readonly string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = ["dataset"];
  for (const ds of EXPORT_DATASETS) {
    for (const c of EXPORT_COLUMNS[ds]) {
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

/** Strict calendar-date check: shape AND a real day (rejects 2026-02-30). */
export function isValidIsoDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function toUtcMs(s: string): number {
  const m = DATE_RE.exec(s)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `date` shifted by `days` calendar days. Pure UTC arithmetic on the date
 *  label, so DST transitions in the user's zone can't skew it. */
export function addDays(date: string, days: number): string {
  return fromUtcMs(toUtcMs(date) + days * MS_PER_DAY);
}

/** Inclusive day count of [from, to]. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY) + 1;
}

/**
 * The calendar date in `timeZone` at instant `now`. Falls back to UTC for a
 * missing or invalid zone. Domain rows are keyed by the user's local date, so
 * "today" must be computed in that zone, not the server's.
 */
export function todayInTimeZone(now: Date, timeZone: string | null | undefined): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  if (timeZone) {
    try {
      return fmt(timeZone);
    } catch {
      // invalid zone → UTC
    }
  }
  return fmt("UTC");
}

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export type ExportRange = { from: string; to: string; days: number };

export type ExportParams = {
  kind: ExportKind;
  format: ExportFormat;
  range: ExportRange;
};

export type ParseResult =
  | { ok: true; params: ExportParams }
  | { ok: false; error: string };

const KINDS: readonly ExportKind[] = [...EXPORT_DATASETS, "all"];
const FORMATS: readonly ExportFormat[] = ["csv", "json"];

/** Empty string (what a blank `<input type="date">` submits) counts as absent. */
function param(sp: URLSearchParams, key: string): string | null {
  const v = sp.get(key);
  if (v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function parseExportParams(sp: URLSearchParams, today: string): ParseResult {
  const kindRaw = param(sp, "kind") ?? "all";
  if (!(KINDS as readonly string[]).includes(kindRaw)) {
    return { ok: false, error: `kind must be one of ${KINDS.join(", ")}` };
  }
  const formatRaw = param(sp, "format") ?? "csv";
  if (!(FORMATS as readonly string[]).includes(formatRaw)) {
    return { ok: false, error: "format must be csv or json" };
  }

  const fromRaw = param(sp, "from");
  const toRaw = param(sp, "to");
  if (fromRaw !== null && !isValidIsoDate(fromRaw)) {
    return { ok: false, error: "from must be a valid YYYY-MM-DD date" };
  }
  if (toRaw !== null && !isValidIsoDate(toRaw)) {
    return { ok: false, error: "to must be a valid YYYY-MM-DD date" };
  }

  // Defaults: `to` = today; `from` = the 90-day window ending at `to`.
  const to = toRaw ?? today;
  const from = fromRaw ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (from > to) {
    return { ok: false, error: "from must be on or before to" };
  }
  const days = daysInclusive(from, to);
  if (days > MAX_RANGE_DAYS) {
    return { ok: false, error: `range is limited to ${MAX_RANGE_DAYS} days (got ${days})` };
  }

  return {
    ok: true,
    params: {
      kind: kindRaw as ExportKind,
      format: formatRaw as ExportFormat,
      range: { from, to, days },
    },
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Keep only allow-listed columns, in contract order; missing → null. */
export function projectRows(dataset: ExportDataset, rows: readonly object[]): ExportRow[] {
  const cols = EXPORT_COLUMNS[dataset];
  return rows.map((r) => {
    const src = r as Record<string, unknown>;
    const out: ExportRow = {};
    for (const c of cols) {
      const v = src[c];
      out[c] =
        v === undefined || v === null
          ? null
          : typeof v === "number" || typeof v === "string" || typeof v === "boolean"
            ? v
            : String(v);
    }
    return out;
  });
}

export type CappedRows = { rows: ExportRow[]; truncated: boolean; total: number };

export function capRows(rows: ExportRow[], max: number = MAX_EXPORT_ROWS): CappedRows {
  return rows.length > max
    ? { rows: rows.slice(0, max), truncated: true, total: rows.length }
    : { rows, truncated: false, total: rows.length };
}

// ---------------------------------------------------------------------------
// CSV (RFC 4180)
// ---------------------------------------------------------------------------

// A spreadsheet treats a cell starting with one of these as a formula
// (CSV/formula injection, OWASP). `sport` and other text fields come from an
// upstream API, so text cells are neutralised with a leading apostrophe.
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * One CSV field. Numbers and booleans are emitted verbatim (so a genuine
 * negative number like `-0.4` stays numeric); strings are formula-neutralised
 * and then quoted when they contain a comma, quote, CR or LF.
 */
export function csvCell(v: ExportCell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = v;
  if (FORMULA_TRIGGER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Header + rows, CRLF line endings (RFC 4180 §2.1), trailing CRLF. */
export function toCsv(columns: readonly string[], rows: readonly ExportRow[]): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

export type DatasetRows = Partial<Record<ExportDataset, CappedRows>>;

/** Combined `kind=all` CSV: one table, `dataset` column first, union of
 *  columns (blank where a dataset has no such column). Datasets in
 *  EXPORT_DATASETS order, each keeping its own row order. */
export function toCombinedCsv(data: DatasetRows): string {
  const rows: ExportRow[] = [];
  for (const ds of EXPORT_DATASETS) {
    for (const r of data[ds]?.rows ?? []) rows.push({ dataset: ds, ...r });
  }
  return toCsv(ALL_CSV_COLUMNS, rows);
}

// ---------------------------------------------------------------------------
// JSON envelope
// ---------------------------------------------------------------------------

export type ExportEnvelope = {
  version: number;
  generated_at: string;
  user_scope: "self";
  kind: ExportKind;
  range: ExportRange;
  truncated: boolean;
  columns: readonly string[] | Record<string, readonly string[]>;
  rows: ExportRow[] | Record<string, ExportRow[]>;
};

export function toJsonEnvelope(
  kind: ExportKind,
  range: ExportRange,
  data: DatasetRows,
  now: Date,
): ExportEnvelope {
  const base = {
    version: EXPORT_VERSION,
    generated_at: now.toISOString(),
    user_scope: "self" as const,
    kind,
    range,
  };
  if (kind === "all") {
    const rows: Record<string, ExportRow[]> = {};
    const columns: Record<string, readonly string[]> = {};
    let truncated = false;
    for (const ds of EXPORT_DATASETS) {
      rows[ds] = data[ds]?.rows ?? [];
      columns[ds] = EXPORT_COLUMNS[ds];
      truncated ||= data[ds]?.truncated ?? false;
    }
    return { ...base, truncated, columns, rows };
  }
  return {
    ...base,
    truncated: data[kind]?.truncated ?? false,
    columns: EXPORT_COLUMNS[kind],
    rows: data[kind]?.rows ?? [],
  };
}

export function isTruncated(data: DatasetRows): boolean {
  return EXPORT_DATASETS.some((ds) => data[ds]?.truncated);
}

/** `whoop-export-<kind>-<from>_to_<to>.<ext>` — ASCII-only by construction. */
export function exportFilename(kind: ExportKind, range: ExportRange, format: ExportFormat): string {
  return `whoop-export-${kind}-${range.from}_to_${range.to}.${format}`;
}
