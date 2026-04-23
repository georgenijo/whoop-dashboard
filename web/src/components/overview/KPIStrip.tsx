import type { CSSProperties } from "react";
import { sparklinePoints } from "@/lib/paths";
import { formatDelta, msToHoursNumber } from "@/lib/format";
import type { CycleRow, RecoveryRow, SleepRow } from "@/lib/db";

function MicroSpark({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return null;
  const pts = sparklinePoints(values, 60, 22);
  const poly = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <svg className="micro-spark" viewBox="0 0 60 22" preserveAspectRatio="none">
      <polyline points={poly} fill="none" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

type CardProps = {
  label: string;
  value: string;
  unit?: string;
  color: string;
  tint?: string;
  delta: { label: string; dir: "up" | "down" | "flat" };
  spark?: number[];
};

function KPI({ label, value, unit, color, tint, delta, spark }: CardProps) {
  const style = { ["--kpi-tint" as keyof CSSProperties]: tint } as CSSProperties;
  return (
    <div className="kpi" style={style}>
      <div className="head">
        <span className="lbl">{label}</span>
        <span className="dot" style={{ background: color, color }} />
      </div>
      <div className="val">
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      <div className={`delta ${delta.dir}`}>{delta.label}</div>
      {spark && spark.length > 1 && <MicroSpark values={spark} color={color} />}
    </div>
  );
}

function toNumbers<T>(rows: T[], pick: (r: T) => number | null | undefined): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = pick(r);
    if (v != null && Number.isFinite(v)) out.push(v);
  }
  return out;
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
  const recoverySpark = toNumbers(p.recoveryTrend, (r) => r.recovery_score);
  const hrvSpark = toNumbers(p.recoveryTrend, (r) => r.hrv);
  const rhrSpark = toNumbers(p.recoveryTrend, (r) => r.rhr);
  const spo2Spark = toNumbers(p.recoveryTrend, (r) => r.spo2);
  const sleepSpark = toNumbers(p.sleepTrend, (r) => msToHoursNumber(r.in_bed_ms));
  const strainSpark = toNumbers(p.strainTrend, (r) => r.strain);

  const latestSleepHours = msToHoursNumber(p.latestSleep?.in_bed_ms ?? null);
  const previousSleepHours = msToHoursNumber(p.previousSleep?.in_bed_ms ?? null);

  return (
    <section className="kpi-strip" aria-label="KPIs">
      <KPI
        label="Recovery"
        value={p.latestRecovery?.recovery_score?.toFixed(0) ?? "—"}
        unit="%"
        color="#00d4aa"
        tint="rgba(0,212,170,0.12)"
        delta={formatDelta(
          p.latestRecovery?.recovery_score ?? null,
          p.previousRecovery?.recovery_score ?? null,
          { unit: "", precision: 0 }
        )}
        spark={recoverySpark}
      />
      <KPI
        label="HRV"
        value={p.latestRecovery?.hrv?.toFixed(0) ?? "—"}
        unit="ms"
        color="#7b61ff"
        tint="rgba(123,97,255,0.12)"
        delta={formatDelta(p.latestRecovery?.hrv ?? null, p.previousRecovery?.hrv ?? null, {
          unit: " ms",
          precision: 0,
        })}
        spark={hrvSpark}
      />
      <KPI
        label="RHR"
        value={p.latestRecovery?.rhr?.toFixed(0) ?? "—"}
        unit="bpm"
        color="#ff6b6b"
        tint="rgba(255,107,107,0.08)"
        delta={formatDelta(p.latestRecovery?.rhr ?? null, p.previousRecovery?.rhr ?? null, {
          unit: " bpm",
          precision: 0,
          reverse: true,
        })}
        spark={rhrSpark}
      />
      <KPI
        label="Sleep"
        value={latestSleepHours != null ? latestSleepHours.toFixed(1) : "—"}
        unit="h"
        color="#00d4aa"
        tint="rgba(0,212,170,0.08)"
        delta={formatDelta(latestSleepHours, previousSleepHours, { unit: "h", precision: 1 })}
        spark={sleepSpark}
      />
      <KPI
        label="Strain"
        value={p.latestCycle?.strain?.toFixed(1) ?? "—"}
        unit=""
        color="#ffaa00"
        tint="rgba(255,170,0,0.08)"
        delta={formatDelta(p.latestCycle?.strain ?? null, p.previousCycle?.strain ?? null, {
          unit: "",
          precision: 1,
        })}
        spark={strainSpark}
      />
      <KPI
        label="SpO2"
        value={p.latestRecovery?.spo2?.toFixed(1) ?? "—"}
        unit="%"
        color="#00d4aa"
        tint="rgba(0,212,170,0.08)"
        delta={formatDelta(p.latestRecovery?.spo2 ?? null, p.previousRecovery?.spo2 ?? null, {
          unit: "%",
          precision: 1,
        })}
        spark={spo2Spark}
      />
    </section>
  );
}
