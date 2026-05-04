import KPIStrip from "@/components/overview/KPIStrip";
import TrendChart from "@/components/charts/TrendChart";
import SleepStagesChart from "@/components/charts/SleepStagesChart";
import SleepStageDonut from "@/components/charts/SleepStageDonut";
import SleepQualityRadar from "@/components/charts/SleepQualityRadar";
import SleepNeedBreakdown from "@/components/charts/SleepNeedBreakdown";
import SleepConsistencyCard from "@/components/charts/SleepConsistencyCard";
import RespiratoryRateChart from "@/components/charts/RespiratoryRateChart";
import SleepCyclesBarChart from "@/components/charts/SleepCyclesBarChart";
import NapCalendar from "@/components/charts/NapCalendar";
import ApneaRiskCard from "@/components/charts/ApneaRiskCard";
import {
  getOverview,
  getFullSleepTrend,
  getRecoveryTrend,
  getLatestSleep,
  getSleepTrend,
  getRecentNaps,
} from "@/lib/db";
import { computeApneaSignal } from "@/lib/analytics/apnea";
import { msToHoursNumber } from "@/lib/format";
import { parseDays, formatRangeLabel } from "@/lib/range";

export const dynamic = "force-dynamic";

export default async function SleepPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const days = parseDays(range);
  const rangeLabel = formatRangeLabel(range);
  const data = getOverview(days);
  const trend = getFullSleepTrend(days);
  const recoveryTrend = getRecoveryTrend(days);
  const apneaRows = computeApneaSignal(trend, recoveryTrend);

  const latestSleep = getLatestSleep();
  const trend14 = getFullSleepTrend(14);
  const trend30 = getSleepTrend(30);
  const naps = getRecentNaps(60);

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
          <SleepStageDonut row={latestSleep} />
          <SleepNeedBreakdown row={latestSleep} />
          <SleepStagesChart rows={trend} />
          <TrendChart
            title="Sleep Duration"
            subtitle={rangeLabel}
            color="#00d4aa"
            gradientId="sleep-dur"
            data={durationData}
            unit="h"
          />
          <SleepCyclesBarChart rows={trend14} />
        </div>
        <div className="col">
          <SleepQualityRadar latest={latestSleep} window={trend30} />
          <SleepConsistencyCard rows={trend14} />
          <RespiratoryRateChart rows={trend14} />
          <TrendChart
            title="Sleep Performance"
            subtitle={rangeLabel}
            color="#7b61ff"
            gradientId="sleep-perf"
            data={perfData}
            unit="%"
          />
          <TrendChart
            title="Sleep Need"
            subtitle={rangeLabel}
            color="#00aaff"
            gradientId="sleep-need"
            data={needData}
            unit="h"
          />
        </div>
      </div>

      <NapCalendar naps={naps} />
      <ApneaRiskCard rows={apneaRows} />
    </>
  );
}
