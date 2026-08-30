import { requireAuth } from "@/lib/auth";
import {
  getAllTimeStats,
  getYearComparison,
  getSportBreakdown,
  getPersonalRecords,
  getMonthlyRollup,
  getWorkoutHistoryFloor,
  type YoyMetric,
} from "@/lib/db";
import { parseRange, rangeLabel, localToday } from "@/lib/ios/range";
import { resolveRangeWindow } from "@/lib/range";
import { sportColor } from "@/lib/sport-color";

export const dynamic = "force-dynamic";

const METERS_PER_MILE = 1609.344;
const KJ_PER_KCAL = 4.184;

type YoyMetricOut = {
  key: string;
  label: string;
  current: number | null;
  prior: number | null;
  delta: number | null;
  unit: string;
  spark: number[];
};

type RecordOut = {
  key: string;
  label: string;
  value_display: string;
  meta: string | null;
};

type StatsResponse = {
  range_label: string;
  all_time: {
    workouts: number;
    active_seconds: number | null;
    distance_m: number | null;
    kilojoules: number | null;
  };
  yoy: {
    year: number;
    prior_year: number;
    period_label: string;
    metrics: YoyMetricOut[];
  };
  by_sport: { sport: string; count: number; color_hex: string }[];
  records: RecordOut[];
  trend: {
    month: string;
    count: number;
    avg_strain: number | null;
    partial: boolean;
  }[];
  history_floor: string | null;
};

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

// h:mm from seconds (e.g. 6120 → "1:42").
function fmtHM(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

/**
 * Map a `YoyMetric` (raw units from getYearComparison) onto the iOS contract,
 * converting current/prior/delta/spark into the display unit the web Stats page
 * uses for that metric. delta is reconstituted in the converted unit so it stays
 * consistent with current/prior.
 */
function buildYoyMetric(
  key: string,
  label: string,
  unit: string,
  m: YoyMetric,
  conv: (v: number) => number,
): YoyMetricOut {
  return {
    key,
    label,
    current: m.current != null ? conv(m.current) : null,
    prior: m.prior != null ? conv(m.prior) : null,
    delta: m.delta != null ? conv(m.delta) : null,
    unit,
    spark: m.spark.map(conv),
  };
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);
    const parsed = parseRange(req);
    if (parsed instanceof Response) return parsed;

    const today = localToday();
    const year = new Date().getFullYear();

    const window = resolveRangeWindow(parsed.range, today);

    const allTime = getAllTimeStats(user.id);
    const yoy = getYearComparison(user.id, year);
    const sports = getSportBreakdown(user.id, window.start, window.end);
    const records = getPersonalRecords(user.id);
    const months = getMonthlyRollup(user.id, window.start, window.end);
    const historyFloor = getWorkoutHistoryFloor(user.id);

    const metrics: YoyMetricOut[] = [
      buildYoyMetric("workouts", "Workouts", "", yoy.workouts, (v) => v),
      buildYoyMetric(
        "distance",
        "Distance",
        "mi",
        yoy.distanceMeters,
        (v) => v / METERS_PER_MILE,
      ),
      buildYoyMetric("active_hours", "Active hours", "h", yoy.activeHours, (v) => v),
      buildYoyMetric(
        "calories",
        "Calories",
        "cal",
        yoy.calories,
        (v) => v,
      ),
    ];

    const recordsOut: RecordOut[] = [
      {
        key: "longest_session",
        label: "Longest session",
        value_display:
          records.longestSessionSec.value != null
            ? fmtHM(records.longestSessionSec.value)
            : "—",
        meta: records.longestSessionSec.meta,
      },
      {
        key: "most_calories",
        label: "Most calories",
        value_display:
          records.mostKilojoules.value != null
            ? `${fmtInt(records.mostKilojoules.value / KJ_PER_KCAL)} cal`
            : "—",
        meta: records.mostKilojoules.meta,
      },
      {
        key: "highest_strain",
        label: "Highest strain",
        value_display:
          records.highestStrain.value != null
            ? records.highestStrain.value.toFixed(1)
            : "—",
        meta: records.highestStrain.meta,
      },
      {
        key: "biggest_week",
        label: "Biggest week",
        value_display:
          records.biggestWeekSec.value != null
            ? fmtHM(records.biggestWeekSec.value)
            : "—",
        meta: records.biggestWeekSec.meta,
      },
      {
        key: "top_hr",
        label: "Top HR",
        value_display:
          records.topHr.value != null ? `${fmtInt(records.topHr.value)} bpm` : "—",
        meta: records.topHr.meta,
      },
      {
        key: "most_sessions_month",
        label: "Most sessions / mo",
        value_display:
          records.mostSessionsMonth.value != null
            ? fmtInt(records.mostSessionsMonth.value)
            : "—",
        meta: records.mostSessionsMonth.meta,
      },
    ];

    const out: StatsResponse = {
      range_label: rangeLabel(parsed.range),
      all_time: {
        workouts: allTime.workouts,
        active_seconds: allTime.activeSeconds,
        distance_m: allTime.distanceMeters,
        kilojoules: allTime.kilojoules,
      },
      yoy: {
        year: yoy.year,
        prior_year: yoy.priorYear,
        period_label: yoy.periodLabel,
        metrics,
      },
      by_sport: sports.map((s) => ({
        sport: s.sport,
        count: s.count,
        color_hex: sportColor(s.sport),
      })),
      records: recordsOut,
      trend: months.map((m) => ({
        month: m.month,
        count: m.count,
        avg_strain: m.avgStrain,
        partial: m.partial,
      })),
      history_floor: historyFloor,
    };
    return Response.json(out);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
