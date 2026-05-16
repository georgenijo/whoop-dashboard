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
import { headers } from "next/headers";
import {
  getOverview,
  getFullSleepTrend,
  getRecoveryTrend,
  getLatestSleep,
  getSleepTrend,
  getRecentNaps,
  getStrainTrend,
} from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
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
  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const { range } = await searchParams;
  const days = parseDays(range);
  const rangeLabel = formatRangeLabel(range);
  const data = getOverview(user.id, days);
  const trend = getFullSleepTrend(user.id, days);
  const recoveryTrend = getRecoveryTrend(user.id, days);
  const apneaRows = computeApneaSignal(trend, recoveryTrend);
  const debtTrend = days >= 30 ? trend : getFullSleepTrend(user.id, 30);

  const latestSleep = getLatestSleep(user.id);
  const trend14 = getFullSleepTrend(user.id, 14);
  const trend30 = getSleepTrend(user.id, 30);
  const naps = getRecentNaps(user.id, 60);

  const trend90 = getFullSleepTrend(user.id, 90);
  const recoveryTrend90 = getRecoveryTrend(user.id, 90);
  const strainTrend90 = getStrainTrend(user.id, 90);
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
            showRollingToggle
          />
        </div>
        <div className="col">
          <SleepQualityRadar latest={latestSleep} window={trend30} />
          <SleepConsistencyCard rows={trend14} />
          <RespiratoryRateChart rows={trend14} />
        </div>
      </div>

      <div className="grid-2col">
        <TrendChart
          title="Sleep Performance"
          subtitle={rangeLabel}
          color="#7b61ff"
          gradientId="sleep-perf"
          data={perfData}
          unit="%"
          showRollingToggle
        />
        <TrendChart
          title="Sleep Need"
          subtitle={rangeLabel}
          color="#00aaff"
          gradientId="sleep-need"
          data={needData}
          unit="h"
          showRollingToggle
        />
        <BedWakeTimeline rows={trend14} />
        <SleepCyclesBarChart rows={trend14} />
        <div className="span-2">
          <BedtimePatternsCard result={bedtimePatternsResult} />
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
    </>
  );
}
