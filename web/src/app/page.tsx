import RecoveryHero from "@/components/overview/RecoveryHero";
import KPIStrip from "@/components/overview/KPIStrip";
import RecoveryTrend from "@/components/overview/RecoveryTrend";
import AIInsightCard from "@/components/overview/AIInsightCard";
import { getOverview } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function OverviewPage() {
  const data = getOverview(30);

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
          <RecoveryTrend rows={data.recoveryTrend} />
        </div>
        <div className="col">{/* Reserved for additional charts in Phase 2. */}</div>
      </div>
    </>
  );
}
