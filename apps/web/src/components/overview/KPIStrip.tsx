import Link from "next/link";
import { formatDelta, msToHoursNumber } from "@/lib/format";
import type { CycleRow, RecoveryRow, SleepRow } from "@/lib/db";

type CardProps = {
  label: string;
  value: string;
  unit?: string;
  metric: "hrv" | "rhr" | "sleep" | "strain" | "spo2";
  delta: { label: string; dir: "up" | "down" | "flat" };
  href: string;
};

function KPI({ label, value, unit, metric, delta, href }: CardProps) {
  return (
    <Link href={href} className={`kpi metric-${metric}`}>
      <div className="head">
        <span className="lbl">{label}</span>
        <span className="dot" />
      </div>
      <div className="val">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className={`delta ${delta.dir}`}>{delta.label}</div>
    </Link>
  );
}

type Props = {
  latestRecovery: RecoveryRow | null;
  previousRecovery: RecoveryRow | null;
  latestCycle: CycleRow | null;
  previousCycle: CycleRow | null;
  latestSleep: SleepRow | null;
  previousSleep: SleepRow | null;
  recoveryTrend: RecoveryRow[];
  strainTrend: CycleRow[];
  sleepTrend: SleepRow[];
};

export default function KPIStrip(p: Props) {
  const latestSleepHours = msToHoursNumber(p.latestSleep?.in_bed_ms ?? null);
  const previousSleepHours = msToHoursNumber(p.previousSleep?.in_bed_ms ?? null);
  const recoveryDates = {
    latestDate: p.latestRecovery?.date,
    previousDate: p.previousRecovery?.date,
  };
  const cycleDates = {
    latestDate: p.latestCycle?.date,
    previousDate: p.previousCycle?.date,
  };
  const sleepDates = {
    latestDate: p.latestSleep?.date,
    previousDate: p.previousSleep?.date,
  };

  return (
    <section className="overview-metrics" aria-label="Today’s metrics">
      <span className="overview-kicker">Today · change from prior reading</span>
      <div className="kpi-strip">
        <KPI
          label="HRV"
          value={p.latestRecovery?.hrv?.toFixed(0) ?? "—"}
          unit="ms"
          metric="hrv"
          delta={formatDelta(p.latestRecovery?.hrv ?? null, p.previousRecovery?.hrv ?? null, { unit: " ms", precision: 0, ...recoveryDates })}
          href="/recovery"
        />
        <KPI
          label="RHR"
          value={p.latestRecovery?.rhr?.toFixed(0) ?? "—"}
          unit="bpm"
          metric="rhr"
          delta={formatDelta(p.latestRecovery?.rhr ?? null, p.previousRecovery?.rhr ?? null, { unit: " bpm", precision: 0, reverse: true, ...recoveryDates })}
          href="/recovery"
        />
        <KPI
          label="Sleep"
          value={latestSleepHours != null ? latestSleepHours.toFixed(1) : "—"}
          unit="h"
          metric="sleep"
          delta={formatDelta(latestSleepHours, previousSleepHours, { unit: "h", precision: 1, ...sleepDates })}
          href="/sleep"
        />
        <KPI
          label="Strain"
          value={p.latestCycle?.strain?.toFixed(1) ?? "—"}
          unit=""
          metric="strain"
          delta={formatDelta(p.latestCycle?.strain ?? null, p.previousCycle?.strain ?? null, { unit: "", precision: 1, ...cycleDates })}
          href="/strain"
        />
        <KPI
          label="SpO₂"
          value={p.latestRecovery?.spo2?.toFixed(1) ?? "—"}
          unit="%"
          metric="spo2"
          delta={formatDelta(p.latestRecovery?.spo2 ?? null, p.previousRecovery?.spo2 ?? null, { unit: "%", precision: 1, ...recoveryDates })}
          href="/recovery"
        />
      </div>
    </section>
  );
}
