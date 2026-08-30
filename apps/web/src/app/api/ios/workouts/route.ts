import { requireAuth } from "@/lib/auth";
import { getWorkoutsRange, getWorkoutRowsRange, type WorkoutRow } from "@/lib/db";
import { parseRange, rangeLabel, localToday } from "@/lib/ios/range";
import { resolveRangeWindow } from "@/lib/range";
import { sportColor } from "@/lib/sport-color";

export const dynamic = "force-dynamic";

const SPORT_FREQUENCY_TOP_N = 5;
const WORKOUTS_CAP = 500;

type SportFrequency = {
  sport: string;
  sessions: number;
  kj: number;
  duration_min: number;
  color_hex: string;
};

type ZoneBreakdown = {
  workout_id: string;
  date: string;
  sport: string | null;
  zones: {
    z0_pct: number;
    z1_pct: number;
    z2_pct: number;
    z3_pct: number;
    z4_pct: number;
    z5_pct: number;
    total_ms: number;
  };
};

type DistanceEntry = {
  workout_id: string;
  date: string;
  sport: string | null;
  distance_km: number;
};

type WorkoutsResponse = {
  range_label: string;
  total_count: number;
  truncated: boolean;
  sport_frequency: SportFrequency[];
  zone_breakdown_recent: ZoneBreakdown[];
  distance_recent: DistanceEntry[];
  workouts: WorkoutRow[];
};

function buildSportFrequency(rows: WorkoutRow[]): SportFrequency[] {
  type Bucket = { sessions: number; kj: number; duration_min: number };
  const totals = new Map<string, Bucket>();
  for (const r of rows) {
    const sport = r.sport ?? "Unknown";
    const b = totals.get(sport) ?? { sessions: 0, kj: 0, duration_min: 0 };
    b.sessions += 1;
    b.kj += r.kilojoule ?? 0;
    b.duration_min += (r.duration_sec ?? 0) / 60;
    totals.set(sport, b);
  }
  const entries = Array.from(totals.entries())
    .map(([sport, b]) => ({ sport, ...b }))
    .filter((e) => e.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions);

  if (entries.length <= SPORT_FREQUENCY_TOP_N) {
    return entries.map((e) => ({ ...e, color_hex: sportColor(e.sport) }));
  }
  const top = entries.slice(0, SPORT_FREQUENCY_TOP_N).map((e) => ({
    ...e,
    color_hex: sportColor(e.sport),
  }));
  const otherBuckets = entries.slice(SPORT_FREQUENCY_TOP_N);
  const other: SportFrequency = {
    sport: "Other",
    sessions: otherBuckets.reduce((s, e) => s + e.sessions, 0),
    kj: otherBuckets.reduce((s, e) => s + e.kj, 0),
    duration_min: otherBuckets.reduce((s, e) => s + e.duration_min, 0),
    color_hex: "#3f3f46",
  };
  return [...top, other];
}

function buildZoneBreakdown(rows: WorkoutRow[]): ZoneBreakdown[] {
  const withZones = rows.filter((r) => {
    const total = (r.zone_0_ms ?? 0) + (r.zone_1_ms ?? 0) + (r.zone_2_ms ?? 0)
      + (r.zone_3_ms ?? 0) + (r.zone_4_ms ?? 0) + (r.zone_5_ms ?? 0);
    return total > 0;
  });
  return withZones.map((r) => {
    const z0 = r.zone_0_ms ?? 0;
    const z1 = r.zone_1_ms ?? 0;
    const z2 = r.zone_2_ms ?? 0;
    const z3 = r.zone_3_ms ?? 0;
    const z4 = r.zone_4_ms ?? 0;
    const z5 = r.zone_5_ms ?? 0;
    const total_ms = z0 + z1 + z2 + z3 + z4 + z5;
    const pct = (v: number): number => (total_ms > 0 ? (v / total_ms) * 100 : 0);
    return {
      workout_id: r.id,
      date: r.date,
      sport: r.sport,
      zones: {
        z0_pct: pct(z0),
        z1_pct: pct(z1),
        z2_pct: pct(z2),
        z3_pct: pct(z3),
        z4_pct: pct(z4),
        z5_pct: pct(z5),
        total_ms,
      },
    };
  });
}

function buildDistance(rows: WorkoutRow[]): DistanceEntry[] {
  return rows
    .filter((r) => r.distance_m != null && r.distance_m > 0)
    .map((r) => ({
      workout_id: r.id,
      date: r.date,
      sport: r.sport,
      distance_km: (r.distance_m as number) / 1000,
    }));
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);
    const parsed = parseRange(req);
    if (parsed instanceof Response) return parsed;

    const end = localToday();
    const window = resolveRangeWindow(parsed.range, end);
    const result = getWorkoutsRange(user.id, window.start, window.end);
    // getWorkoutsRange returns rows ordered date DESC and caps at 500
    // internally, so total_count and truncated mirror that contract exactly.
    const rows = result.rows;
    const chartRows = result.truncated
      ? getWorkoutRowsRange(user.id, window.start, window.end)
      : rows;

    const body: WorkoutsResponse = {
      range_label: rangeLabel(parsed.range),
      total_count: result.total_count,
      truncated: result.truncated,
      sport_frequency: buildSportFrequency(chartRows),
      zone_breakdown_recent: buildZoneBreakdown(chartRows),
      distance_recent: buildDistance(chartRows),
      workouts: rows.slice(0, WORKOUTS_CAP),
    };
    return Response.json(body);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
