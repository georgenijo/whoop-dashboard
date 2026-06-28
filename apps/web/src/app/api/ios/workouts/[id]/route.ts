import { requireAuth } from "@/lib/auth";
import {
  getWorkoutById,
  getWorkoutHrSeries,
  getWorkoutSource,
  getBodyMeasurements,
  getRecoveryTrend,
} from "@/lib/db";
import {
  parseHrSeries,
  recoveryRate,
  timeAbovePct,
  trimp,
  type HrSeries,
} from "@/lib/analytics/workoutMetrics";

export const dynamic = "force-dynamic";

type ZonesPayload = {
  z0_ms: number;
  z1_ms: number;
  z2_ms: number;
  z3_ms: number;
  z4_ms: number;
  z5_ms: number;
};

type HrSeriesPayload = {
  interval_sec: number;
  start_offset_sec: number;
  bpm: (number | null)[];
};

type DerivedPayload = {
  cardiac_drift_pct: number | null;
  recovery_rate_bpm: number | null;
  time_above_90_sec: number | null;
  trimp: number | null;
};

type WorkoutDetailResponse = {
  id: string;
  date: string;
  sport: string | null;
  source: "whoop" | "healthkit" | null;
  start_local: string | null;
  end_local: string | null;
  duration_sec: number | null;
  strain: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  kilojoule: number | null;
  distance_m: number | null;
  zones: ZonesPayload | null;
  hr_series: HrSeriesPayload | null;
  profile: { max_hr: number | null; resting_hr: number | null };
  derived: DerivedPayload | null;
};

/**
 * Intra-session cardiac drift — identical to the web detail page
 * (`workouts/[id]/page.tsx`): % change in mean HR from the first half of the
 * session to the second. Positive = HR climbed for the same effort. `null` when
 * there isn't enough signal in either half.
 */
function intraSessionDrift(series: HrSeries): number | null {
  const { bpm, interval_sec, start_offset_sec } = series;
  const pts: { t: number; v: number }[] = [];
  for (let i = 0; i < bpm.length; i++) {
    const v = bpm[i];
    if (v == null) continue;
    pts.push({ t: start_offset_sec + i * interval_sec, v });
  }
  if (pts.length < 4) return null;
  const mid = (pts[0].t + pts[pts.length - 1].t) / 2;
  const first = pts.filter((p) => p.t < mid);
  const second = pts.filter((p) => p.t >= mid);
  if (first.length < 2 || second.length < 2) return null;
  const mean = (a: { v: number }[]) => a.reduce((s, p) => s + p.v, 0) / a.length;
  const m1 = mean(first);
  const m2 = mean(second);
  if (m1 <= 0) return null;
  return ((m2 - m1) / m1) * 100;
}

/**
 * Format a UTC ISO timestamp as a naive local ISO (YYYY-MM-DDTHH:MM:SS) in the
 * user's IANA tz via Intl (DST-correct). Mirrors the coach-tool boundary
 * (`coach/tools.ts:formatLocalIso`). Falls back to UTC when the tz is unknown so
 * the field stays populated and parseable.
 */
function formatLocalIso(utcIso: string | null, tz: string): string | null {
  if (!utcIso) return null;
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(d);
    const get = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? "";
    const year = get("year");
    const month = get("month");
    const day = get("day");
    let hour = get("hour");
    if (hour === "24") hour = "00";
    const minute = get("minute");
    const second = get("second");
    if (!year || !month || !day || !minute || !second) return null;
    return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  } catch {
    return null;
  }
}

export async function GET(
  req: Request,
  // Next.js 16.2.4: dynamic route params are async (a Promise) — await before use.
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await requireAuth(req);
    const { id } = await params;

    const workout = getWorkoutById(user.id, id);
    if (!workout) {
      // Unknown id, or another user's workout — getWorkoutById is tenant-scoped,
      // so cross-tenant ids resolve to undefined. Both map to 404.
      return Response.json({ error: "Workout not found" }, { status: 404 });
    }

    // Provenance: a null/absent source column reads as null (pre-migration).
    const rawSource = getWorkoutSource(user.id, id);
    const source: "whoop" | "healthkit" | null =
      rawSource === "whoop" || rawSource === "healthkit" ? rawSource : null;

    // HR stream — null when absent. `series` is the cleaned/validated form.
    const series = parseHrSeries(getWorkoutHrSeries(user.id, id));
    const hasSignal = !!series && series.bpm.some((b) => b != null);

    // Profile max HR: prefer the measured profile max, fall back to this
    // workout's own peak (matches the web detail page).
    const body = getBodyMeasurements(user.id);
    const maxHr = body?.max_heart_rate ?? workout.max_hr ?? null;

    // 30-day mean resting HR for TRIMP's HRr term. null when no recovery signal.
    const restingHr = (() => {
      const rows = getRecoveryTrend(user.id, 30);
      const vals = rows
        .map((r) => r.rhr)
        .filter((v): v is number => v != null && v > 0);
      if (vals.length === 0) return null;
      return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
    })();

    // Zones: null when every zone bucket is 0/absent.
    const z0 = workout.zone_0_ms ?? 0;
    const z1 = workout.zone_1_ms ?? 0;
    const z2 = workout.zone_2_ms ?? 0;
    const z3 = workout.zone_3_ms ?? 0;
    const z4 = workout.zone_4_ms ?? 0;
    const z5 = workout.zone_5_ms ?? 0;
    const totalZoneMs = z0 + z1 + z2 + z3 + z4 + z5;
    const zones: ZonesPayload | null =
      totalZoneMs > 0
        ? {
            z0_ms: z0,
            z1_ms: z1,
            z2_ms: z2,
            z3_ms: z3,
            z4_ms: z4,
            z5_ms: z5,
          }
        : null;

    const hr_series: HrSeriesPayload | null = series
      ? {
          interval_sec: series.interval_sec,
          start_offset_sec: series.start_offset_sec,
          bpm: series.bpm,
        }
      : null;

    // Derived metrics — computed exactly as the web detail page does. null when
    // there's no usable HR signal; each sub-field is independently null when its
    // function can't compute (e.g. no profile baseline for TRIMP).
    const derived: DerivedPayload | null =
      hasSignal && series
        ? {
            cardiac_drift_pct: intraSessionDrift(series),
            recovery_rate_bpm: recoveryRate(series),
            time_above_90_sec: timeAbovePct(series, maxHr, 0.9),
            trimp:
              maxHr != null && restingHr != null
                ? trimp(series, { rest: restingHr, max: maxHr })
                : null,
          }
        : null;

    const tz = user.timezone ?? "UTC";

    const out: WorkoutDetailResponse = {
      id: workout.id,
      date: workout.date,
      sport: workout.sport,
      source,
      start_local: formatLocalIso(workout.start_utc ?? null, tz),
      end_local: formatLocalIso(workout.end_utc ?? null, tz),
      duration_sec: workout.duration_sec,
      strain: workout.strain,
      avg_hr: workout.avg_hr,
      max_hr: workout.max_hr,
      kilojoule: workout.kilojoule,
      distance_m: workout.distance_m,
      zones,
      hr_series,
      profile: { max_hr: maxHr, resting_hr: restingHr },
      derived,
    };
    return Response.json(out);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
