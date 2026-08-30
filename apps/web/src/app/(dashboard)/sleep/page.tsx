import KPIStrip from "@/components/overview/KPIStrip";
import TrendChart from "@/components/charts/TrendChart";
import SleepStagesChart from "@/components/charts/SleepStagesChart";
import SleepStageDonut from "@/components/charts/SleepStageDonut";
import SleepQualityRadar from "@/components/charts/SleepQualityRadar";
import SleepNeedBreakdown from "@/components/charts/SleepNeedBreakdown";
import SleepConsistencyCard from "@/components/charts/SleepConsistencyCard";
import RespiratoryRateChart from "@/components/charts/RespiratoryRateChart";
import SleepCyclesBarChart from "@/components/charts/SleepCyclesBarChart";
import NapsList from "@/components/charts/NapsList";
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
  getRecoveryRange,
  getLatestSleep,
  getSleepRange,
  getNaps,
  getStrainRange,
} from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import { computeApneaSignal } from "@/lib/analytics/apnea";
import { computeBedtimeRecoveryCorr, computeBedtimePatterns } from "@/lib/analytics/bedtime";
import { computeNapImpact, withStartHour } from "@/lib/analytics/naps";
import { computeDeepSleepEfficiency } from "@/lib/analytics/deepSleep";
import { msToHoursNumber } from "@/lib/format";
import { resolveRangeWindow, shiftDate } from "@/lib/range";
import { localToday } from "@/lib/date";

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
  const window = resolveRangeWindow(range, localToday());
  const { days, label: rangeLabel } = window;
  const data = getOverview(user.id, days);
  const trend = getSleepRange(user.id, window.start, window.end);
  const recoveryTrend = getRecoveryRange(user.id, window.start, window.end);
  const apneaRows = computeApneaSignal(trend, recoveryTrend);

  const latestSleep = getLatestSleep(user.id);
  const naps = getNaps(user.id, window.start, window.end);
  const napsWithHour = withStartHour(naps);
  const bedtimeRecoveryResult = computeBedtimeRecoveryCorr(trend, recoveryTrend);
  const bedtimePatternsResult = computeBedtimePatterns(trend);
  const napImpact = computeNapImpact(naps, trend);
  const priorStrainStart = window.start === "0000-01-01"
    ? window.start
    : shiftDate(window.start, -1);
  const deepSleepEffRows = computeDeepSleepEfficiency(
    trend,
    getStrainRange(user.id, priorStrainStart, window.end),
  );

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
          <SleepQualityRadar latest={latestSleep} window={trend} rangeLabel={rangeLabel} />
          <SleepConsistencyCard rows={trend} rangeLabel={rangeLabel} />
          <RespiratoryRateChart rows={trend} rangeLabel={rangeLabel} />
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
        <BedWakeTimeline rows={trend} rangeLabel={rangeLabel} />
        <SleepCyclesBarChart rows={trend} rangeLabel={rangeLabel} />
        <div className="span-2">
          <BedtimePatternsCard result={bedtimePatternsResult} rangeLabel={rangeLabel} />
        </div>
      </div>

      <div className="grid-2col">
        <NapsList naps={naps} rangeLabel={rangeLabel} />
        <NapTrackerCard naps={napsWithHour} impact={napImpact} rangeLabel={rangeLabel} />
      </div>

      <div className="grid-main">
        <div className="col">
          <BedtimeRecoveryScatter result={bedtimeRecoveryResult} rangeLabel={rangeLabel} />
        </div>
        <div className="col">
          <NapRecoveryScatter naps={naps} recovery={recoveryTrend} rangeLabel={rangeLabel} />
        </div>
      </div>

      <ApneaRiskCard rows={apneaRows} rangeLabel={rangeLabel} />
      <DeepSleepEfficiencyCard rows={deepSleepEffRows} rangeLabel={rangeLabel} />
      <SleepDebtChart rows={trend} rangeLabel={rangeLabel} />
    </>
  );
}
