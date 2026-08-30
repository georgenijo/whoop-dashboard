import { headers } from "next/headers";
import KPIStrip from "@/components/overview/KPIStrip";
import TrendChart from "@/components/charts/TrendChart";
import HRVTrend from "@/components/charts/HRVTrend";
import StrainRecoveryScatter from "@/components/charts/StrainRecoveryScatter";
import RecoveryReboundCard from "@/components/charts/RecoveryReboundCard";
import DayOfWeekRecovery from "@/components/recovery/DayOfWeekRecovery";
import OvertrainingCard from "@/components/recovery/OvertrainingCard";
import IllnessSignalCard from "@/components/recovery/IllnessSignalCard";
import SkinTempDeviationCard from "@/components/recovery/SkinTempDeviationCard";
import Spo2TrendCard from "@/components/recovery/Spo2TrendCard";
import {
  getOverview,
  getRecoveryByDayOfWeek,
  getRecoveryRange,
  getSleepRange,
  getStrainRange,
} from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import { computeIllnessSignal } from "@/lib/analytics/illness";
import { computeRebound } from "@/lib/analytics/rebound";
import { resolveRangeWindow, shiftDate } from "@/lib/range";
import { localToday } from "@/lib/date";

export const dynamic = "force-dynamic";

// getRecoveryTrend / getStrainTrend each `LIMIT N` ordered by date desc within
// their own table, so a recovery row dated D and a cycles row dated D might not
// both appear in the same N-day window if either table has gaps. Over-fetch and
// let computeOTS do the inner-join + slice(-7) (cost is negligible — it always
// trims to the last 7 paired days).
const OTS_LOOKBACK_DAYS = 30;

export default async function RecoveryPage({
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
  const trend = getRecoveryRange(user.id, window.start, window.end);
  const strainTrend = getStrainRange(user.id, window.start, window.end);
  const sleepTrend = getSleepRange(user.id, window.start, window.end);
  const otsRecovery = trend.slice(-OTS_LOOKBACK_DAYS);
  const otsCycles = strainTrend.slice(-OTS_LOOKBACK_DAYS);

  const recoveryData = trend.map((r) => ({ date: r.date, value: r.recovery_score }));
  const hrvSeries = trend.map((r) => ({ date: r.date, hrv: r.hrv }));
  const rhrData = trend.map((r) => ({ date: r.date, value: r.rhr }));
  const skinTempSeries = trend.map((r) => ({
    date: r.date,
    skin_temp: r.skin_temp,
    recovery_score: r.recovery_score,
  }));
  const spo2Series = trend.map((r) => ({ date: r.date, spo2: r.spo2 }));

  // Illness signal needs ~14 days of pre-window history for the baseline,
  // plus the current display window.
  const baselineStart = window.start === "0000-01-01"
    ? window.start
    : shiftDate(window.start, -14);
  const illnessRecovery = getRecoveryRange(user.id, baselineStart, window.end);
  const illnessSleep = getSleepRange(user.id, baselineStart, window.end);
  const illnessRows = computeIllnessSignal(illnessRecovery, illnessSleep)
    .filter((row) => row.date >= window.start && row.date <= window.end);
  const dowRecovery = getRecoveryByDayOfWeek(user.id, window.start, window.end);

  const strainByDate = new Map(strainTrend.map((c) => [c.date, c.strain]));
  const sleepByDate = new Map(
    sleepTrend.map((s) => {
      const total = (s.light_ms ?? 0) + (s.deep_ms ?? 0) + (s.rem_ms ?? 0);
      const hours =
        s.light_ms != null && s.deep_ms != null && s.rem_ms != null
          ? total / 3_600_000
          : null;
      return [s.date, hours];
    })
  );
  const scatterRows = trend.map((r) => ({
    date: r.date,
    strain: strainByDate.get(r.date) ?? null,
    recovery: r.recovery_score,
    sleep_hours: sleepByDate.get(r.date) ?? null,
  }));

  const reboundEvents = computeRebound(trend);

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

      <OvertrainingCard recovery={otsRecovery} cycles={otsCycles} />

      <DayOfWeekRecovery rows={dowRecovery} rangeLabel={rangeLabel} />

      <div className="grid-main">
        <div className="col">
          <TrendChart
            title="Recovery score"
            subtitle={rangeLabel}
            color="#00d4aa"
            gradientId="recovery"
            data={recoveryData}
            unit="%"
            showRollingToggle
          />
          <HRVTrend subtitle={rangeLabel} data={hrvSeries} />
          <SkinTempDeviationCard data={skinTempSeries} rangeLabel={rangeLabel} />
        </div>
        <div className="col">
          <TrendChart
            title="Resting Heart Rate"
            subtitle={rangeLabel}
            color="#ff6b6b"
            gradientId="rhr"
            data={rhrData}
            unit=" bpm"
            showRollingToggle
          />
          <Spo2TrendCard data={spo2Series} rangeLabel={rangeLabel} />
        </div>
      </div>

      <IllnessSignalCard rows={illnessRows} rangeLabel={rangeLabel} />

      <StrainRecoveryScatter rows={scatterRows} rangeLabel={rangeLabel} />

      <RecoveryReboundCard events={reboundEvents} rangeLabel={rangeLabel} />
    </>
  );
}
