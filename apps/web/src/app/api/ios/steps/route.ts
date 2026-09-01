import { requireAuth } from "@/lib/auth";
import { getOverview, getStepsTrend } from "@/lib/db";
import { buildKPITiles, type KPITile } from "@/lib/ios/kpi";
import { localToday, parseRange, rangeLabel } from "@/lib/ios/range";
import { resolveRangeWindow } from "@/lib/range";
import { rollingMean } from "@/lib/analytics/trends";

export const dynamic = "force-dynamic";

type TrendPoint = { date: string; raw: number | null; ma7: number | null };
type Today = { date: string; steps: number | null; vs_7d_avg: number | null };
type StepsResponse = {
  range_label: string;
  kpi: KPITile[];
  steps_trend: TrendPoint[];
  today: Today;
};

function mean(values: (number | null)[]): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  return valid.length > 0 ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);
    const parsed = parseRange(req);
    if (parsed instanceof Response) return parsed;

    const today = localToday();
    const window = resolveRangeWindow(parsed.range, today);
    const trend = getStepsTrend(user.id, window.start, window.end);
    const values = trend.map((row) => row.steps);
    const ma7 = rollingMean(values, 7);
    const steps_trend: TrendPoint[] = trend.map((row, index) => ({
      date: row.date,
      raw: values[index],
      ma7: ma7[index],
    }));

    const todaySteps = trend.find((row) => row.date === today)?.steps ?? null;
    const todayComparisonAverage = todaySteps == null ? null : mean(values.slice(-7));
    const body: StepsResponse = {
      range_label: rangeLabel(parsed.range),
      kpi: buildKPITiles(getOverview(user.id, parsed.days)),
      steps_trend,
      today: {
        date: today,
        steps: todaySteps,
        vs_7d_avg: todayComparisonAverage,
      },
    };
    return Response.json(body);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
