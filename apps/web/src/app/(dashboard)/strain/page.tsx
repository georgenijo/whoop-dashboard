import { headers } from "next/headers";
import KPIStrip from "@/components/overview/KPIStrip";
import TrendChart from "@/components/charts/TrendChart";
import TSBCurve from "@/components/charts/TSBCurve";
import { getOverview, getStrainTrend } from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import { parseDays, formatRangeLabel } from "@/lib/range";

export const dynamic = "force-dynamic";

export default async function StrainPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const { range } = await searchParams;
  const days = parseDays(range);
  const rangeLabel = formatRangeLabel(range);
  const data = getOverview(user.id, days);
  const trend = getStrainTrend(user.id, days);
  const tsbTrend = days >= 180 ? trend : getStrainTrend(user.id, 180);

  const strainData = trend.map((r) => ({ date: r.date, value: r.strain }));
  const hrData = trend.map((r) => ({ date: r.date, value: r.avg_hr }));

  return (
    <>
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
          <TrendChart
            title="Daily Strain"
            subtitle={rangeLabel}
            color="#ffaa00"
            gradientId="strain"
            data={strainData}
            unit=""
          />
        </div>
        <div className="col">
          <TrendChart
            title="Average Heart Rate"
            subtitle={rangeLabel}
            color="#ff6b6b"
            gradientId="avg-hr"
            data={hrData}
            unit=" bpm"
          />
        </div>
      </div>

      <TSBCurve rows={tsbTrend} />
    </>
  );
}
