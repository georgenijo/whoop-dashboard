import SleepHero from "@/components/sleep/atelier/SleepHero";
import StagesPlate from "@/components/sleep/atelier/StagesPlate";
import SleepTrendCard from "@/components/sleep/atelier/SleepTrendCard";
import AtelierSleepConsistencyCard from "@/components/sleep/atelier/SleepConsistencyCard";
import NeedBreakdown from "@/components/sleep/atelier/NeedBreakdown";
import BedtimeDistribution from "@/components/sleep/atelier/BedtimeDistribution";
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
import SleepDebtChart from "@/components/charts/SleepDebtChart";
import BedWakeTimeline from "@/components/charts/BedWakeTimeline";
import BedtimeRecoveryScatter from "@/components/charts/BedtimeRecoveryScatter";
import BedtimePatternsCard from "@/components/charts/BedtimePatternsCard";
import NapTrackerCard from "@/components/charts/NapTrackerCard";
import NapRecoveryScatter from "@/components/charts/NapRecoveryScatter";
import DeepSleepEfficiencyCard from "@/components/charts/DeepSleepEfficiencyCard";
import {
  getOverview,
  getFullSleepTrend,
  getRecoveryTrend,
  getLatestSleep,
  getSleepTrend,
  getRecentNaps,
  getStrainTrend,
} from "@/lib/db";
import { computeApneaSignal } from "@/lib/analytics/apnea";
import { computeBedtimeRecoveryCorr, computeBedtimePatterns } from "@/lib/analytics/bedtime";
import { computeNapImpact, withStartHour } from "@/lib/analytics/naps";
import { computeDeepSleepEfficiency } from "@/lib/analytics/deepSleep";
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
  const debtTrend = days >= 30 ? trend : getFullSleepTrend(30);

  const latestSleep = getLatestSleep();
  const trend14 = getFullSleepTrend(14);
  const trend30 = getSleepTrend(30);
  const naps = getRecentNaps(60);

  const trend90 = getFullSleepTrend(90);
  const recoveryTrend90 = getRecoveryTrend(90);
  const strainTrend90 = getStrainTrend(90);
  const napsWithHour = withStartHour(naps);
  const bedtimeRecoveryResult = computeBedtimeRecoveryCorr(trend90, recoveryTrend90);
  const bedtimePatternsResult = computeBedtimePatterns(trend90);
  const napImpact = computeNapImpact(naps, trend90);
  const deepSleepEffRows = computeDeepSleepEfficiency(trend90, strainTrend90);

  const durationData = trend.map((r) => ({ date: r.date, value: msToHoursNumber(r.in_bed_ms) }));
  const needData = trend.map((r) => ({ date: r.date, value: msToHoursNumber(r.sleep_need_ms) }));
  const perfData = trend.map((r) => ({ date: r.date, value: r.performance }));

  return (
    <>
      <div className="classic-sleep">
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
          <BedWakeTimeline rows={trend14} />
          <RespiratoryRateChart rows={trend14} />
          <BedtimePatternsCard result={bedtimePatternsResult} />
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
      <NapTrackerCard naps={napsWithHour} impact={napImpact} />

      <div className="grid-main">
        <div className="col">
          <BedtimeRecoveryScatter result={bedtimeRecoveryResult} />
        </div>
        <div className="col">
          <NapRecoveryScatter naps={naps} recovery={recoveryTrend90} />
        </div>
      </div>

      <ApneaRiskCard rows={apneaRows} />
      <DeepSleepEfficiencyCard rows={deepSleepEffRows} />
      <SleepDebtChart rows={debtTrend} />
      </div>

      <div className="atelier-sleep">
        <SleepHero latest={latestSleep} />
        <StagesPlate latest={latestSleep} />
        <div className="atelier-sleep-row-2">
          <SleepTrendCard rows={trend14} />
          <AtelierSleepConsistencyCard rows={trend14} />
        </div>
        <NeedBreakdown latest={latestSleep} />
        <BedtimeDistribution rows={trend90} />
      </div>
    </>
  );
}
