import { requireAuth } from "@/lib/auth";
import { getOverview, getRecoveryTrend } from "@/lib/db";
import { buildKPITiles, type KPITile } from "@/lib/ios/kpi";
import { parseRange, rangeLabel } from "@/lib/ios/range";
import { rollingMean, detectHRVAnomalies, type HRVAnomaly } from "@/lib/analytics/trends";

export const dynamic = "force-dynamic";

// Mirrors the recovery page: recovery trend + HRV trend (with anomaly
// detection) + RHR trend + SpO2 30d series. Page-level range governs
// recovery/HRV/RHR; SpO2 is always 30d (web does the same).

type TrendPoint = {
  date: string;
  raw: number | null;
  ma7: number | null;
  ma30: number | null;
};

type Spo2Point = { date: string; value: number | null };

type Spo2Block = {
  points: Spo2Point[];
  avg: number | null;
  lowest: number | null;
  best: number | null;
  y_min: number;
  y_max: number;
} | null;

type RecoveryResponse = {
  range_label: string;
  kpi: KPITile[];
  recovery_trend: TrendPoint[];
  hrv_trend: {
    points: TrendPoint[];
    anomalies: HRVAnomaly[];
  };
  rhr_trend: TrendPoint[];
  spo2_trend: Spo2Block;
};

function buildTrend(
  rows: { date: string }[],
  series: (number | null)[],
): TrendPoint[] {
  const ma7 = rollingMean(series, 7);
  const ma30 = rollingMean(series, 30);
  return rows.map((r, i) => ({
    date: r.date,
    raw: series[i],
    ma7: ma7[i],
    ma30: ma30[i],
  }));
}

function buildSpo2(trend30: { date: string; spo2: number | null }[]): Spo2Block {
  const valid = trend30
    .filter((r): r is { date: string; spo2: number } => r.spo2 != null && Number.isFinite(r.spo2));
  if (valid.length === 0) return null;
  const values = valid.map((r) => r.spo2);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const lowest = Math.min(...values);
  const best = Math.max(...values);
  // Mirrors Spo2TrendCard: y-axis floor 94 (or lower if data dips below),
  // ceiling 100 (or higher if data spikes above).
  const y_min = Math.min(94, Math.floor(lowest));
  const y_max = Math.max(100, Math.ceil(best));
  return {
    points: trend30.map((r) => ({ date: r.date, value: r.spo2 })),
    avg,
    lowest,
    best,
    y_min,
    y_max,
  };
}

export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);
    const parsed = parseRange(req);
    if (parsed instanceof Response) return parsed;

    const trend = getRecoveryTrend(user.id, parsed.days);
    const overview = getOverview(user.id, parsed.days);

    const recovery_trend = buildTrend(trend, trend.map((r) => r.recovery_score));
    const hrvPoints = buildTrend(trend, trend.map((r) => r.hrv));
    const rhr_trend = buildTrend(trend, trend.map((r) => r.rhr));
    const anomalies = detectHRVAnomalies(
      trend.map((r) => ({ date: r.date, hrv: r.hrv })),
    );

    // SpO2 always pulls 30d regardless of page range — matches the web
    // Spo2TrendCard subtitle "30-day · 95% floor".
    const trend30 = parsed.days === 30 ? trend : getRecoveryTrend(user.id, 30);
    const spo2_trend = buildSpo2(trend30.map((r) => ({ date: r.date, spo2: r.spo2 })));

    const body: RecoveryResponse = {
      range_label: rangeLabel(parsed.range),
      kpi: buildKPITiles(overview),
      recovery_trend,
      hrv_trend: { points: hrvPoints, anomalies },
      rhr_trend,
      spo2_trend,
    };
    return Response.json(body);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
