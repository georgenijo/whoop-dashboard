import KPIStrip from "@/components/overview/KPIStrip";
import TrendChart from "@/components/charts/TrendChart";
import HRVTrend from "@/components/charts/HRVTrend";
import OvertrainingCard from "@/components/recovery/OvertrainingCard";
import IllnessSignalCard from "@/components/recovery/IllnessSignalCard";
import {
  getOverview,
  getRecoveryRange,
  getRecoveryTrend,
  getSleepRange,
  getStrainTrend,
} from "@/lib/db";
import { computeIllnessSignal } from "@/lib/analytics/illness";
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
  const otsRecovery = getRecoveryTrend(7);
  const otsCycles = getStrainTrend(7);

  const recoveryData = trend.map((r) => ({ date: r.date, value: r.recovery_score }));
  const hrvSeries = trend.map((r) => ({ date: r.date, hrv: r.hrv }));
  const rhrData = trend.map((r) => ({ date: r.date, value: r.rhr }));
  const spo2Data = trend.map((r) => ({ date: r.date, value: r.spo2 }));

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

      <div className="grid-main">
        <div className="col">
          <TrendChart
            title="Recovery score"
            subtitle={rangeLabel}
            color="#00d4aa"
            gradientId="recovery"
            data={recoveryData}
            unit="%"
          />
          <HRVTrend subtitle={rangeLabel} data={hrvSeries} />
        </div>
        <div className="col">
          <TrendChart
            title="Resting Heart Rate"
            subtitle={rangeLabel}
            color="#ff6b6b"
            gradientId="rhr"
            data={rhrData}
            unit=" bpm"
          />
          <TrendChart
            title="SpO2"
            subtitle={rangeLabel}
            color="#00aaff"
            gradientId="spo2"
            data={spo2Data}
            unit="%"
          />
        </div>
      </div>

      <IllnessSignalCard rows={illnessRows} />
    </>
  );
}
