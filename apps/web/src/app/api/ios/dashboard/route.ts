import { requireAuth } from "@/lib/auth";
import {
  getOverview,
  getPRStats,
  getRecoveryTrend,
  getLatestWhoopDataTimestamp,
} from "@/lib/db";
import { getInsightStatus } from "@/lib/insights";
import { buildKPITiles, type KPITile } from "@/lib/ios/kpi";
import { parseRange, localToday } from "@/lib/ios/range";
import { rollingMean } from "@/lib/analytics/trends";

export const dynamic = "force-dynamic";

// Mirrors the data shape rendered by `app/(dashboard)/page.tsx`. iOS clients
// hit this endpoint once per dashboard refresh — single round-trip, no
// follow-up queries. Empty DB returns the full envelope with null/empty
// fields rather than 404'ing.

type RecoveryHero = {
  score: number | null;
  hrv_ms: number | null;
  rhr_bpm: number | null;
  updated_at: string | null;
};

type AiInsight = {
  text: string | null;
  created_at: string | null;
  is_stale: boolean;
} | null;

type PRPayload = {
  best_hrv: { value: number; date: string } | null;
  lowest_rhr: { value: number; date: string } | null;
  recovery_streak: { count: number; start_date: string; end_date: string } | null;
  sleep_perf_streak: { count: number; start_date: string; end_date: string } | null;
  logging_streak: { count: number; start_date: string; end_date: string } | null;
};

type RecoveryTrendPoint = {
  date: string;
  raw: number | null;
  ma7: number | null;
};

type DashboardResponse = {
  data_date: string | null;
  is_fallback: boolean;
  recovery_hero: RecoveryHero;
  ai_insight: AiInsight;
  kpi: KPITile[];
  prs: PRPayload;
  recovery_trend: RecoveryTrendPoint[];
};

export async function GET(req: Request) {
  try {
    const { user } = await requireAuth(req);
    const parsed = parseRange(req);
    if (parsed instanceof Response) return parsed;

    const overview = getOverview(user.id, parsed.days);

    // Recovery trend always uses 30d — the overview page does the same and
    // the iOS hero chart expects a consistent baseline width regardless of
    // the page-level range selector.
    const trend30 = getRecoveryTrend(user.id, 30);
    const trendValues = trend30.map((r) => r.recovery_score);
    const ma7 = rollingMean(trendValues, 7);
    const recovery_trend: RecoveryTrendPoint[] = trend30.map((r, i) => ({
      date: r.date,
      raw: r.recovery_score,
      ma7: ma7[i],
    }));

    const insightStatus = getInsightStatus(user.id, overview.hasData);
    const ai_insight: AiInsight = insightStatus.insight
      ? {
          text: insightStatus.insight.insight,
          created_at: insightStatus.insight.created_at,
          is_stale: insightStatus.isStale,
        }
      : null;

    const pr = getPRStats(user.id);
    const prs: PRPayload = {
      best_hrv: pr.bestHRV,
      lowest_rhr: pr.lowestRHR,
      recovery_streak: pr.recoveryStreak,
      sleep_perf_streak: pr.sleepPerfStreak,
      logging_streak: pr.loggingStreak,
    };

    const latestRecovery = overview.latestRecovery;
    const recovery_hero: RecoveryHero = {
      score: latestRecovery?.recovery_score ?? null,
      hrv_ms: latestRecovery?.hrv ?? null,
      rhr_bpm: latestRecovery?.rhr ?? null,
      updated_at: overview.hasData ? getLatestWhoopDataTimestamp(user.id) : null,
    };

    // data_date is the latest row's date; is_fallback fires when the most
    // recent row is older than server-local today.
    const today = localToday();
    const data_date = latestRecovery?.date
      ?? overview.latestCycle?.date
      ?? overview.latestSleep?.date
      ?? null;
    const is_fallback = data_date !== null && data_date !== today;

    const body: DashboardResponse = {
      data_date,
      is_fallback,
      recovery_hero,
      ai_insight,
      kpi: buildKPITiles(overview),
      prs,
      recovery_trend,
    };
    return Response.json(body);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
}
