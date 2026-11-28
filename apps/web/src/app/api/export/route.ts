import { requireAuth } from "@/lib/auth";
import {
  getNaps,
  getRecoveryRange,
  getSleepRangeRaw,
  getStepsRange,
  getStrainRange,
  getWorkoutRowsRange,
} from "@/lib/db";
import { getInsightTimezone } from "@/lib/db/summary";
import { isDataExportEnabled } from "@/lib/export/flag";
import {
  EXPORT_COLUMNS,
  EXPORT_DATASETS,
  capRows,
  exportFilename,
  isTruncated,
  parseExportParams,
  projectRows,
  toCombinedCsv,
  toCsv,
  toJsonEnvelope,
  todayInTimeZone,
  type DatasetRows,
  type ExportDataset,
  type ExportRange,
} from "@/lib/export/data-export";

export const dynamic = "force-dynamic";

// GET /api/export — the signed-in user's own domain data as CSV or JSON.
// Off unless DATA_EXPORT=1 (see src/lib/export/flag.ts, docs/data-export.md).
//
// Tenant isolation: the only user id used is `requireAuth`'s, and every read
// goes through the existing `@/lib/db` readers, which bind it via
// `forUser(userId)`. Output columns are an allow-list (EXPORT_COLUMNS), so no
// user_id, row id, raw JSON, token or log field can appear in a file.

function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}

/** Rows for one dataset, sorted by date (then start time) ascending. */
function readDataset(userId: number, ds: ExportDataset, r: ExportRange): object[] {
  switch (ds) {
    case "recovery":
      return getRecoveryRange(userId, r.from, r.to);
    case "cycles":
      return getStrainRange(userId, r.from, r.to);
    case "workouts":
      // Reader returns DESC; exports read top-to-bottom chronologically.
      return getWorkoutRowsRange(userId, r.from, r.to)
        .slice()
        .sort((a, b) =>
          a.date === b.date
            ? (a.start_utc ?? "").localeCompare(b.start_utc ?? "")
            : a.date.localeCompare(b.date),
        );
    case "sleep": {
      // Undeduped main sleeps (an export is a record of what happened, not a
      // one-point-per-day chart) plus naps, flagged with `nap`.
      const main = getSleepRangeRaw(userId, r.from, r.to).map((s) => ({ ...s, sleep_cycles: s.cycles, nap: false }));
      const naps = getNaps(userId, r.from, r.to).map((n) => ({
        ...n,
        in_bed_ms: n.duration_ms,
        nap: true,
      }));
      return [...main, ...naps].sort((a, b) =>
        a.date === b.date
          ? (a.start_local ?? "").localeCompare(b.start_local ?? "")
          : a.date.localeCompare(b.date),
      );
    }
    case "steps":
      return getStepsRange(userId, r.from, r.to);
  }
}

export async function GET(req: Request): Promise<Response> {
  // Flag first: when off, nothing below runs — no auth lookup, no DB read.
  if (!isDataExportEnabled()) return notFound();

  const { user } = await requireAuth(req);
  const now = new Date();
  // "Today" in the user's own zone (settings tz → account tz → UTC): domain
  // rows are keyed by local date, so the server's clock would be off by one
  // near midnight.
  const today = todayInTimeZone(now, getInsightTimezone(user.id));
  const parsed = parseExportParams(new URL(req.url).searchParams, today);
  if (!parsed.ok) {
    return Response.json({ error: "invalid_request", message: parsed.error }, { status: 400 });
  }
  const { kind, format, range } = parsed.params;

  const datasets: readonly ExportDataset[] = kind === "all" ? EXPORT_DATASETS : [kind];
  const data: DatasetRows = {};
  for (const ds of datasets) {
    data[ds] = capRows(projectRows(ds, readDataset(user.id, ds, range)));
  }

  const body =
    format === "json"
      ? JSON.stringify(toJsonEnvelope(kind, range, data, now), null, 2) + "\n"
      : kind === "all"
        ? toCombinedCsv(data)
        : toCsv(EXPORT_COLUMNS[kind], data[kind]!.rows);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type":
        format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(kind, range, format)}"`,
      "Cache-Control": "no-store, private",
      "X-Export-Truncated": isTruncated(data) ? "1" : "0",
    },
  });
}
