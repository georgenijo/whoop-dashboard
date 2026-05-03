import KPIStrip from "@/components/overview/KPIStrip";
import TrendChart from "@/components/charts/TrendChart";
import OvertrainingCard from "@/components/recovery/OvertrainingCard";
import { getOverview, getRecoveryTrend, getStrainTrend } from "@/lib/db";
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
  const hrvData = trend.map((r) => ({ date: r.date, value: r.hrv }));
  const rhrData = trend.map((r) => ({ date: r.date, value: r.rhr }));
  const spo2Data = trend.map((r) => ({ date: r.date, value: r.spo2 }));

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
          <TrendChart
            title="HRV"
            subtitle={rangeLabel}
            color="#7b61ff"
            gradientId="hrv"
            data={hrvData}
            unit=" ms"
          />
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
    </>
  );
}
