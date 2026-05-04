import { after } from "next/server";
import RecoveryHero from "@/components/overview/RecoveryHero";
import KPIStrip from "@/components/overview/KPIStrip";
import RecoveryTrend from "@/components/overview/RecoveryTrend";
import AIInsightCard from "@/components/overview/AIInsightCard";
import AIInsightRefreshWatcher from "@/components/overview/AIInsightRefreshWatcher";
import PRsCard from "@/components/overview/PRsCard";
import {
  getDailySummary,
  getOverview,
  getPRStats,
  getRecoveryTrend,
  type DailySummaryRow,
  type RecoveryRow,
} from "@/lib/db";
import {
  acquireInsightRegenerationLock,
  getInsightStatus,
  regenerateInsight,
} from "@/lib/insights";
import { parseDays } from "@/lib/range";

export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const days = parseDays(range);
  const data = getOverview(days);
  const trend = getRecoveryTrend(days);
  const prStats = getPRStats();
  const summaryByDate = new Map(
    getDailySummary("0000-01-01", "9999-12-31")
      .filter((r) => r.recovery_score != null)
      .map((r) => [r.date, r] as const)
  );
  const latestRecovery = recoveryFromSummary(
    data.latestRecovery ? summaryByDate.get(data.latestRecovery.date) : undefined,
    data.latestRecovery
  );
  const previousRecovery = recoveryFromSummary(
    data.previousRecovery ? summaryByDate.get(data.previousRecovery.date) : undefined,
    data.previousRecovery
  );
  const hasInsightData =
    data.latestRecovery !== null || data.latestCycle !== null || data.latestSleep !== null;
  const insightStatus = getInsightStatus(hasInsightData);
  const insightLock = acquireInsightRegenerationLock(insightStatus);
  const insightRefreshing = insightStatus.isRegenerating || insightLock !== null;

  if (insightLock !== null) {
    after(() => regenerateInsight(insightLock));
  }

  return (
    <>
      <div className="hero">
        <RecoveryHero
          score={latestRecovery?.recovery_score ?? null}
          hrv={latestRecovery?.hrv ?? null}
          rhr={latestRecovery?.rhr ?? null}
          updatedAt={latestRecovery?.date ?? null}
        />
        <AIInsightCard
          hasData={hasInsightData}
          insight={insightStatus.insight}
          refreshing={insightRefreshing}
        />
      </div>
      {insightStatus.isStale && insightRefreshing ? <AIInsightRefreshWatcher /> : null}

      <KPIStrip
        latestRecovery={latestRecovery}
        previousRecovery={previousRecovery}
        latestCycle={data.latestCycle}
        previousCycle={data.previousCycle}
        latestSleep={data.latestSleep}
        previousSleep={data.previousSleep}
        recoveryTrend={data.recoveryTrend}
        strainTrend={data.strainTrend}
        sleepTrend={data.sleepTrend}
      />

      <PRsCard stats={prStats} />

      <div className="grid-main">
        <div className="col">
          <RecoveryTrend rows={trend} />
        </div>
        <div className="col">{/* Phase 2 */}</div>
      </div>
    </>
  );
}

function recoveryFromSummary(
  row: DailySummaryRow | undefined,
  fallback: RecoveryRow | null
): RecoveryRow | null {
  if (!row) return fallback;
  const sameDate = fallback?.date === row.date;
  return {
    date: row.date,
    recovery_score: row.recovery_score,
    hrv: row.hrv_ms,
    rhr: row.resting_hr,
    spo2: sameDate ? fallback.spo2 : null,
    skin_temp: sameDate ? fallback.skin_temp : null,
  };
}
