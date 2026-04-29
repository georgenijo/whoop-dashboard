import RecoveryHero from "@/components/overview/RecoveryHero";
import KPIStrip from "@/components/overview/KPIStrip";
import RecoveryTrend from "@/components/overview/RecoveryTrend";
import AIInsightCard from "@/components/overview/AIInsightCard";
import { getOverview, getRecoveryTrend } from "@/lib/db";
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

  return (
    <>
      <div className="hero">
        <RecoveryHero
          score={data.latestRecovery?.recovery_score ?? null}
          hrv={data.latestRecovery?.hrv ?? null}
          rhr={data.latestRecovery?.rhr ?? null}
          updatedAt={data.latestRecovery?.date ?? null}
        />
        <AIInsightCard hasData={data.hasData} />
      </div>

      <KPIStrip
        latestRecovery={data.latestRecovery}
        previousRecovery={data.previousRecovery}
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
