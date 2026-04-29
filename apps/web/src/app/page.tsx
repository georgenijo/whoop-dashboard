import RecoveryHero from "@/components/overview/RecoveryHero";
import KPIStrip from "@/components/overview/KPIStrip";
import RecoveryTrend from "@/components/overview/RecoveryTrend";
import AIInsightCard from "@/components/overview/AIInsightCard";
import {
  getDailySummary,
  getOverview,
  getRecoveryTrend,
  type DailySummaryRow,
  type RecoveryRow,
} from "@/lib/db";
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
  const summaryRecovery = getDailySummary("0000-01-01", "9999-12-31").filter(
    (r) => r.recovery_score != null
  );
  const latestSummary = summaryRecovery[summaryRecovery.length - 1];
  const previousSummary = summaryRecovery[summaryRecovery.length - 2];
  const latestRecovery = recoveryFromSummary(latestSummary, data.latestRecovery);
  const previousRecovery = recoveryFromSummary(previousSummary, data.previousRecovery);

  return (
    <>
      <div className="hero">
        <RecoveryHero
          score={latestRecovery?.recovery_score ?? null}
          hrv={latestRecovery?.hrv ?? null}
          rhr={latestRecovery?.rhr ?? null}
          updatedAt={latestRecovery?.date ?? null}
        />
        <AIInsightCard hasData={data.hasData} />
      </div>

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
