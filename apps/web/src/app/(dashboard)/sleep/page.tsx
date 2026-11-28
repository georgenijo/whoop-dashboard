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
import TonightSleepPlanCard from "@/components/charts/TonightSleepPlanCard";
import Link from "next/link";
import { headers } from "next/headers";
import {
  getOverviewSnapshot,
  getRecoveryRange,
  getSleepRange,
  getNaps,
  getStrainRange,
} from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import { computeApneaSignal } from "@/lib/analytics/apnea";
import { computeBedtimeRecoveryCorr, computeBedtimePatterns } from "@/lib/analytics/bedtime";
import { computeNapImpact, withStartHour } from "@/lib/analytics/naps";
import { computeDeepSleepEfficiency } from "@/lib/analytics/deepSleep";
import {
  computeSleepPlan,
  isSleepPlanEnabled,
  SLEEP_PLAN_LOOKBACK_DAYS,
} from "@/lib/analytics/sleepPlan";
import { msToHoursNumber } from "@/lib/format";
import { resolveRangeWindow, shiftDate } from "@/lib/range";
import { localToday } from "@/lib/date";
import { isSleepRegularityEnabled } from "@/lib/sleep-regularity-flag";

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
  const { label: rangeLabel } = window;
  const data = getOverviewSnapshot(user.id);
  const trend = getSleepRange(user.id, window.start, window.end);
  const recoveryTrend = getRecoveryRange(user.id, window.start, window.end);
  const apneaRows = computeApneaSignal(trend, recoveryTrend);

  // Same row getLatestSleep returns (non-nap, deduped, newest date).
  const latestSleep = data.latestSleep;
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

  // SLEEP_PLAN=1 gates the "Tonight" card. Flag off: no extra reads, no
  // render. It uses its own fixed lookback so the plan doesn't change with
  // the range picker.
  const sleepPlan = isSleepPlanEnabled() ? loadSleepPlan(user.id) : null;

  const durationData = trend.map((r) => ({ date: r.date, value: msToHoursNumber(r.in_bed_ms) }));
  const needData = trend.map((r) => ({ date: r.date, value: msToHoursNumber(r.sleep_need_ms) }));
  const perfData = trend.map((r) => ({ date: r.date, value: r.performance }));

  return (
    <>
      {isSleepRegularityEnabled() && (
        <Link
          href="/sleep/regularity"
          className="card"
          data-testid="sleep-regularity-link"
          style={{ display: "block", marginBottom: 24, textDecoration: "none", color: "inherit" }}
        >
          <div className="card-title">
            <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
            Sleep regularity →
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            Regularity index, bed/wake consistency and social jetlag
          </div>
        </Link>
      )}
      <KPIStrip
        latestRecovery={data.latestRecovery}
        previousRecovery={data.previousRecovery}
        latestCycle={data.latestCycle}
        previousCycle={data.previousCycle}
        latestSleep={data.latestSleep}
        previousSleep={data.previousSleep}
        latestSteps={data.latestSteps}
        previousSteps={data.previousSteps}
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
      {sleepPlan && <TonightSleepPlanCard plan={sleepPlan} />}
      <SleepDebtChart rows={trend} rangeLabel={rangeLabel} />
    </>
  );
}

function loadSleepPlan(userId: number) {
  const today = localToday();
  const start = shiftDate(today, -(SLEEP_PLAN_LOOKBACK_DAYS - 1));
  return computeSleepPlan(
    getSleepRange(userId, start, today),
    getRecoveryRange(userId, start, today),
    today,
  );
}
