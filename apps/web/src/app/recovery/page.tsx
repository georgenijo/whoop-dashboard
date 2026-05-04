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
  getRecoveryTrend,
  getSleepRange,
  getSleepTrend,
  getStrainTrend,
} from "@/lib/db";
import { computeIllnessSignal } from "@/lib/analytics/illness";
import { computeRebound } from "@/lib/analytics/rebound";
import { parseDays, formatRangeLabel } from "@/lib/range";

export const dynamic = "force-dynamic";

export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range } = await searchParams;
  const days = parseDays(range);
  const rangeLabel = formatRangeLabel(range);
  const data = getOverview(days);
  const trend = getRecoveryTrend(days);
  const trend30 = getRecoveryTrend(30);
  const otsRecovery = getRecoveryTrend(7);
  const otsCycles = getStrainTrend(7);

  const recoveryData = trend.map((r) => ({ date: r.date, value: r.recovery_score }));
  const hrvSeries = trend.map((r) => ({ date: r.date, hrv: r.hrv }));
  const rhrData = trend.map((r) => ({ date: r.date, value: r.rhr }));
  const skinTempSeries = trend30.map((r) => ({
    date: r.date,
    skin_temp: r.skin_temp,
    recovery_score: r.recovery_score,
  }));
  const spo2Series = trend30.map((r) => ({ date: r.date, spo2: r.spo2 }));

  // Illness signal needs ~14 days of pre-window history for the baseline,
  // plus the current display window.
  const illnessDays = Math.max(days, 30) + 14;
  const today = new Date();
  const end = today.toISOString().slice(0, 10);
  const start = new Date(today.getTime() - illnessDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const illnessRecovery = getRecoveryRange(start, end);
  const illnessSleep = getSleepRange(start, end);
  const illnessRows = computeIllnessSignal(illnessRecovery, illnessSleep);
  const dowRecovery = getRecoveryByDayOfWeek();

  const strain30 = getStrainTrend(30);
  const sleep30 = getSleepTrend(30);
  const strainByDate = new Map(strain30.map((c) => [c.date, c.strain]));
  const sleepByDate = new Map(
    sleep30.map((s) => {
      const total = (s.light_ms ?? 0) + (s.deep_ms ?? 0) + (s.rem_ms ?? 0);
      const hours =
        s.light_ms != null && s.deep_ms != null && s.rem_ms != null
          ? total / 3_600_000
          : null;
      return [s.date, hours];
    })
  );
  const scatterRows = trend30.map((r) => ({
    date: r.date,
    strain: strainByDate.get(r.date) ?? null,
    recovery: r.recovery_score,
    sleep_hours: sleepByDate.get(r.date) ?? null,
  }));

  const reboundRecovery = getRecoveryTrend(Math.max(days, 90));
  const reboundEvents = computeRebound(reboundRecovery);

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

      <DayOfWeekRecovery rows={dowRecovery} />

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
          <SkinTempDeviationCard data={skinTempSeries} />
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
          <Spo2TrendCard data={spo2Series} />
        </div>
      </div>

      <IllnessSignalCard rows={illnessRows} />

      <StrainRecoveryScatter rows={scatterRows} />

      <RecoveryReboundCard events={reboundEvents} />
    </>
  );
}
