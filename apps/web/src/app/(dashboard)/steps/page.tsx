import { headers } from "next/headers";
import KPIStrip from "@/components/overview/KPIStrip";
import TrendChart from "@/components/charts/TrendChart";
import { getOverview, getStepsTrend } from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import { resolveRangeWindow } from "@/lib/range";
import { localToday } from "@/lib/date";

export const dynamic = "force-dynamic";

export default async function StepsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const { range } = await searchParams;
  const window = resolveRangeWindow(range, localToday());
  const overview = getOverview(user.id, window.days);
  const trend = getStepsTrend(user.id, window.start, window.end);

  return (
    <>
      <KPIStrip
        latestRecovery={overview.latestRecovery}
        previousRecovery={overview.previousRecovery}
        latestCycle={overview.latestCycle}
        previousCycle={overview.previousCycle}
        latestSleep={overview.latestSleep}
        previousSleep={overview.previousSleep}
        latestSteps={overview.latestSteps}
        previousSteps={overview.previousSteps}
        recoveryTrend={overview.recoveryTrend}
        strainTrend={overview.strainTrend}
        sleepTrend={overview.sleepTrend}
      />

      <div className="card" style={{ marginTop: "var(--s6)", paddingTop: 0 }}>
        <div className="card-sub">Apple Health · synced by Coach iOS</div>
      </div>

      <TrendChart
        title="Daily Steps"
        subtitle={window.label}
        color="#5ac8fa"
        gradientId="steps"
        data={trend.map((row) => ({ date: row.date, value: row.steps }))}
        unit=" steps"
        showRollingToggle
        emptySubtext="Sync Apple Health from Coach iOS to populate this chart"
      />
    </>
  );
}
