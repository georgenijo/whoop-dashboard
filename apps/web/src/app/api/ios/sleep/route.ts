import { requireAuth } from "@/lib/auth";
import { getFullSleepTrend, getLatestSleep, getOverview } from "@/lib/db";
import { buildKPITiles, type KPITile } from "@/lib/ios/kpi";
import { parseRange, rangeLabel } from "@/lib/ios/range";
import { rollingMean } from "@/lib/analytics/trends";

export const dynamic = "force-dynamic";

const MS_PER_HOUR = 3_600_000;

type SleepStages = {
  light_ms: number;
  deep_ms: number;
  rem_ms: number;
  awake_ms: number;
};

type NeedBreakdown = {
  baseline_ms: number;
  debt_ms: number;
  strain_ms: number;
  nap_ms: number;
};

type LatestSleep = {
  date: string;
  stages: SleepStages | null;
  need_breakdown: NeedBreakdown | null;
} | null;

type DurationPoint = { date: string; raw_hours: number | null; ma7: number | null };
type PerfPoint = { date: string; raw: number | null; ma7: number | null };

type SleepResponse = {
  range_label: string;
  kpi: KPITile[];
  latest_sleep: LatestSleep;
  duration_trend: DurationPoint[];
  performance_trend: PerfPoint[];
};

function buildLatest(row: ReturnType<typeof getLatestSleep>): LatestSleep {
  if (!row) return null;
  const stages =
    row.light_ms != null && row.deep_ms != null && row.rem_ms != null && row.awake_ms != null
      ? {
          light_ms: row.light_ms,
          deep_ms: row.deep_ms,
          rem_ms: row.rem_ms,
          awake_ms: row.awake_ms,
        }
      : null;
  const need_breakdown =
    row.need_from_baseline_ms != null ||
    row.need_from_debt_ms != null ||
    row.need_from_strain_ms != null ||
    row.need_from_nap_ms != null
      ? {
          baseline_ms: row.need_from_baseline_ms ?? 0,
          debt_ms: row.need_from_debt_ms ?? 0,
          strain_ms: row.need_from_strain_ms ?? 0,
          nap_ms: row.need_from_nap_ms ?? 0,
        }
      : null;
  return { date: row.date, stages, need_breakdown };
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);
    const parsed = parseRange(req);
    if (parsed instanceof Response) return parsed;

    const trend = getFullSleepTrend(user.id, parsed.days);
    const overview = getOverview(user.id, parsed.days);
    const latest = getLatestSleep(user.id);

    const durationRaw = trend.map((r) =>
      r.in_bed_ms != null && Number.isFinite(r.in_bed_ms) ? r.in_bed_ms / MS_PER_HOUR : null,
    );
    const durationMa7 = rollingMean(durationRaw, 7);
    const duration_trend: DurationPoint[] = trend.map((r, i) => ({
      date: r.date,
      raw_hours: durationRaw[i],
      ma7: durationMa7[i],
    }));

    const perfRaw = trend.map((r) => r.performance);
    const perfMa7 = rollingMean(perfRaw, 7);
    const performance_trend: PerfPoint[] = trend.map((r, i) => ({
      date: r.date,
      raw: perfRaw[i],
      ma7: perfMa7[i],
    }));

    const body: SleepResponse = {
      range_label: rangeLabel(parsed.range),
      kpi: buildKPITiles(overview),
      latest_sleep: buildLatest(latest),
      duration_trend,
      performance_trend,
    };
    return Response.json(body);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
