import KPIStrip from "@/components/overview/KPIStrip";
import TrendChart from "@/components/charts/TrendChart";
import SleepStagesChart from "@/components/charts/SleepStagesChart";
import { getOverview, getFullSleepTrend } from "@/lib/db";
import { msToHoursNumber } from "@/lib/format";
import { parseDays } from "@/lib/range";

export const dynamic = "force-dynamic";

export default async function SleepPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const days = parseDays(range);
  const data = getOverview(days);
  const trend = getFullSleepTrend(days);

  const durationData = trend.map((r) => ({ date: r.date, value: msToHoursNumber(r.in_bed_ms) }));
  const needData = trend.map((r) => ({ date: r.date, value: msToHoursNumber(r.sleep_need_ms) }));
  const perfData = trend.map((r) => ({ date: r.date, value: r.performance }));

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
          <SleepStagesChart rows={trend} />
          <TrendChart
            title="Sleep Duration"
            subtitle={`${days} days`}
            color="#00d4aa"
            gradientId="sleep-dur"
            data={durationData}
            unit="h"
          />
        </div>
        <div className="col">
          <TrendChart
            title="Sleep Performance"
            subtitle={`${days} days`}
            color="#7b61ff"
            gradientId="sleep-perf"
            data={perfData}
            unit="%"
          />
          <TrendChart
            title="Sleep Need"
            subtitle={`${days} days`}
            color="#00aaff"
            gradientId="sleep-need"
            data={needData}
            unit="h"
          />
        </div>
      </div>
    </>
  );
}
