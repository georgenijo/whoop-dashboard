import "server-only";
import { openWrite } from "@/lib/db/connection";
import { forUser } from "@/lib/db/scoped";
import { parseDate, recomputeDailySummary } from "@/lib/whoop/upsert";
import { parseHrSeries, type HrSeries } from "@/lib/analytics/workoutMetrics";

// HealthKit workout ingestion (issue #425). The web app owns the `workouts`
// table; this module is the single HK write path. Reads (match lookups) route
// through `forUser()` so they stay tenant-scoped and the scoped.test.ts CI
// guard passes; writes go through openWrite() directly, matching sync.ts. This
// file is on the scoped.test.ts allowlist as a domain write helper.

/** Match window: an HK workout within ±60s of an existing row's start is the
 *  same session (clock skew between Whoop's and Apple's record boundaries). */
const MATCH_WINDOW_MS = 60_000;
// SQL pre-filter window — wider than the exact JS check to absorb any ISO
// formatting differences between stored Whoop `raw.start` and our bounds.
const SQL_WINDOW_MS = 5 * 60_000;
// Hard ceiling on stored stream length — iOS is expected to downsample to
// ~600 points; reject anything wildly larger rather than bloat the row.
const MAX_HR_SERIES_POINTS = 5000;

export type HealthKitWorkoutInput = {
  external_id: string;
  sport: string;
  start: string;
  end: string;
  source_name?: string;
  kilojoule?: number | null;
  distance_m?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  hr_series?: unknown;
};

export type IngestResult = {
  matched: number;
  inserted: number;
  enriched: number;
  skipped: number;
};

type CandidateRow = {
  id: string;
  sport: string | null;
  hr_series: string | null;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  start_utc: string | null;
};

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Normalize a sport name for compatibility comparison: lowercase, strip
 * everything but a-z0-9. Whoop ("Soccer") and HealthKit ("soccer"/"football")
 * use different casing and a few synonyms, so we canonicalize known aliases.
 */
const SPORT_ALIASES: Record<string, string> = {
  football: "soccer",
  soccer: "soccer",
  run: "running",
  running: "running",
  jog: "running",
  jogging: "running",
  ride: "cycling",
  bike: "cycling",
  biking: "cycling",
  cycling: "cycling",
  walk: "walking",
  walking: "walking",
  weightlifting: "weightlifting",
  weighttraining: "weightlifting",
  strengthtraining: "weightlifting",
  functionalstrengthtraining: "weightlifting",
};

function canonSport(sport: string | null | undefined): string {
  const norm = (sport ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return SPORT_ALIASES[norm] ?? norm;
}

function sportsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = canonSport(a);
  const cb = canonSport(b);
  if (!ca || !cb) return false;
  return ca === cb;
}

/** Validate a single incoming workout. Returns the parsed shape or null. */
function validate(
  w: unknown,
): {
  external_id: string;
  sport: string;
  startMs: number;
  endMs: number;
  start: string;
  end: string;
  kilojoule: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  hrSeries: HrSeries | null;
} | null {
  if (!w || typeof w !== "object") return null;
  const o = w as Record<string, unknown>;
  const external_id = typeof o.external_id === "string" ? o.external_id.trim() : "";
  const sport = typeof o.sport === "string" ? o.sport.trim() : "";
  const start = typeof o.start === "string" ? o.start : "";
  const end = typeof o.end === "string" ? o.end : "";
  if (!external_id || !sport || !start || !end) return null;

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;

  let hrSeries = parseHrSeries(o.hr_series);
  if (hrSeries && hrSeries.bpm.length > MAX_HR_SERIES_POINTS) hrSeries = null;

  return {
    external_id,
    sport,
    startMs,
    endMs,
    start,
    end,
    kilojoule: num(o.kilojoule),
    distance_m: num(o.distance_m),
    avg_hr: num(o.avg_hr),
    max_hr: num(o.max_hr),
    hrSeries,
  };
}

/**
 * Ingest a batch of HealthKit workouts for `userId`. Idempotent on replay via
 * the `external_id` column. Returns per-outcome counts. `matched` is a superset
 * that includes `enriched` (matches we wrote to) plus matches that already had
 * a stream (no-op); `matched + inserted + skipped == valid input count`, and
 * invalid rows fall into `skipped`.
 */
export function ingestHealthKitWorkouts(
  workouts: unknown[],
  userId: number,
  tz: string,
): IngestResult {
  const result: IngestResult = { matched: 0, inserted: 0, enriched: 0, skipped: 0 };
  if (!Array.isArray(workouts) || workouts.length === 0) return result;

  const db = openWrite();
  if (!db) throw new Error("DB unavailable (no whoop_data.db at expected path)");

  const enrichStmt = db.prepare(`
    UPDATE workouts SET
      hr_series   = COALESCE(@hr_series, hr_series),
      external_id = COALESCE(external_id, @external_id),
      distance_m  = COALESCE(distance_m, @distance_m),
      avg_hr      = COALESCE(avg_hr, @avg_hr),
      max_hr      = COALESCE(max_hr, @max_hr)
    WHERE id = @id AND user_id = @user_id
  `);
  const insertStmt = db.prepare(`
    INSERT INTO workouts
      (user_id, id, external_id, source, date, sport, duration_sec,
       avg_hr, max_hr, distance_m, kilojoule, hr_series, raw)
    VALUES
      (@user_id, @id, @external_id, 'healthkit', @date, @sport, @duration_sec,
       @avg_hr, @max_hr, @distance_m, @kilojoule, @hr_series, @raw)
  `);
  // Linkage-only update for a match that already has a stream (so a later
  // replay short-circuits on the external_id check). Never touches data.
  const linkStmt = db.prepare(
    "UPDATE workouts SET external_id = @external_id WHERE id = @id AND user_id = @user_id AND external_id IS NULL",
  );

  const insertedDates = new Set<string>();

  try {
    for (const raw of workouts) {
      const v = validate(raw);
      if (!v) {
        result.skipped += 1;
        continue;
      }

      // Idempotency: this external_id was already ingested (inserted, or linked
      // onto an enriched Whoop row). No-op.
      const seen = forUser(userId).get<{ id: string }>(
        "SELECT id FROM workouts WHERE external_id = ? AND user_id = ?",
        v.external_id,
      );
      if (seen) {
        result.skipped += 1;
        continue;
      }

      // Time-window candidates (SQL pre-filter, then exact JS check).
      const loIso = new Date(v.startMs - SQL_WINDOW_MS).toISOString();
      const hiIso = new Date(v.startMs + SQL_WINDOW_MS).toISOString();
      const candidates = forUser(userId).all<CandidateRow>(
        `SELECT id, sport, hr_series, distance_m, avg_hr, max_hr,
                json_extract(raw, '$.start') AS start_utc
         FROM workouts
         WHERE json_extract(raw, '$.start') >= ?
           AND json_extract(raw, '$.start') <= ?
           AND user_id = ?`,
        loIso,
        hiIso,
      );

      let best: CandidateRow | null = null;
      let bestDiff = Infinity;
      for (const c of candidates) {
        if (!c.start_utc) continue;
        if (!sportsCompatible(c.sport, v.sport)) continue;
        const diff = Math.abs(new Date(c.start_utc).getTime() - v.startMs);
        if (diff <= MATCH_WINDOW_MS && diff < bestDiff) {
          bestDiff = diff;
          best = c;
        }
      }

      if (best) {
        result.matched += 1;
        const hrJson = v.hrSeries ? JSON.stringify(v.hrSeries) : null;
        if (best.hr_series == null) {
          // Enrich: set stream + fill only-null scalars. COALESCE in SQL
          // guarantees we never overwrite Whoop's strain/kilojoule (not in the
          // column list) or any already-populated distance/avg/max.
          enrichStmt.run({
            id: best.id,
            user_id: userId,
            external_id: v.external_id,
            hr_series: hrJson,
            distance_m: v.distance_m,
            avg_hr: v.avg_hr,
            max_hr: v.max_hr,
          });
          result.enriched += 1;
        } else {
          // Already has a stream — record linkage so replays no-op, no data
          // change. Counted in `matched` only.
          linkStmt.run({ id: best.id, user_id: userId, external_id: v.external_id });
        }
        continue;
      }

      // No match — insert an HK-only workout row.
      const date = parseDate(v.start, tz);
      const durationSec = (v.endMs - v.startMs) / 1000;
      insertStmt.run({
        user_id: userId,
        id: `hk:${v.external_id}`,
        external_id: v.external_id,
        date,
        sport: v.sport,
        duration_sec: durationSec,
        avg_hr: v.avg_hr,
        max_hr: v.max_hr,
        distance_m: v.distance_m,
        kilojoule: v.kilojoule,
        hr_series: v.hrSeries ? JSON.stringify(v.hrSeries) : null,
        raw: JSON.stringify({
          source: "healthkit",
          external_id: v.external_id,
          sport: v.sport,
          start: v.start,
          end: v.end,
          source_name:
            typeof (raw as Record<string, unknown>).source_name === "string"
              ? (raw as Record<string, unknown>).source_name
              : null,
        }),
      });
      result.inserted += 1;
      insertedDates.add(date);
    }
  } finally {
    db.close();
  }

  // A new HK-only row changes that day's workouts_count, so refresh the
  // daily_summary rollup. Enrich/link paths don't add rows, so they don't.
  for (const date of insertedDates) {
    recomputeDailySummary(date, userId);
  }

  return result;
}
