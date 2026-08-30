import { requireAuth } from "@/lib/auth";
import {
  getOverview,
  getStrainRange,
  getTodayStrainAggregate,
  getTodayWorkouts,
} from "@/lib/db";
import { buildKPITiles, type KPITile } from "@/lib/ios/kpi";
import { parseRange, rangeLabel, localToday } from "@/lib/ios/range";
import { resolveRangeWindow } from "@/lib/range";
import { rollingMean } from "@/lib/analytics/trends";
import { kJToKcal } from "@/lib/format";

export const dynamic = "force-dynamic";

type TodayWorkout = {
  id: string;
  sport: string | null;
  start_time_iso: string | null;
  duration_sec: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  strain: number | null;
};

type TrendPoint = { date: string; raw: number | null; ma7: number | null };

type StrainResponse = {
  range_label: string;
  kpi: KPITile[];
  today: {
    date: string;
    total_kilojoule: number | null;
    total_kcal: number | null;
    avg_hr: number | null;
    max_hr: number | null;
    workout_count: number;
    workouts: TodayWorkout[];
  };
  strain_trend: TrendPoint[];
  avg_hr_trend: TrendPoint[];
};

export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);
    const parsed = parseRange(req);
    if (parsed instanceof Response) return parsed;

    const today = localToday();
    const window = resolveRangeWindow(parsed.range, today);
    const trend = getStrainRange(user.id, window.start, window.end);
    const overview = getOverview(user.id, parsed.days);
    const todayAgg = getTodayStrainAggregate(user.id, today);
    const todayWorkouts = getTodayWorkouts(user.id, today);

    const strainSeries = trend.map((r) => r.strain);
    const strainMa7 = rollingMean(strainSeries, 7);
    const strain_trend: TrendPoint[] = trend.map((r, i) => ({
      date: r.date,
      raw: strainSeries[i],
      ma7: strainMa7[i],
    }));

    const hrSeries = trend.map((r) => r.avg_hr);
    const hrMa7 = rollingMean(hrSeries, 7);
    const avg_hr_trend: TrendPoint[] = trend.map((r, i) => ({
      date: r.date,
      raw: hrSeries[i],
      ma7: hrMa7[i],
    }));

    const workouts: TodayWorkout[] = todayWorkouts.map((w) => ({
      id: w.id,
      sport: w.sport,
      // TodayWorkoutRow's `start_time` is sourced from raw JSON. Surface it
      // as an ISO string for the iOS client.
      start_time_iso: w.start_time ?? w.start_utc ?? null,
      duration_sec: w.duration_sec,
      distance_m: w.distance_m,
      avg_hr: w.avg_hr,
      max_hr: w.max_hr,
      strain: w.strain,
    }));

    const body: StrainResponse = {
      range_label: rangeLabel(parsed.range),
      kpi: buildKPITiles(overview),
      today: {
        date: today,
        total_kilojoule: todayAgg.total_kilojoule,
        total_kcal: kJToKcal(todayAgg.total_kilojoule),
        avg_hr: todayAgg.avg_hr,
        max_hr: todayAgg.max_hr,
        workout_count: todayAgg.workout_count,
        workouts,
      },
      strain_trend,
      avg_hr_trend,
    };
    return Response.json(body);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
