import type { CSSProperties } from "react";
import Link from "next/link";
import { formatDelta, msToHoursNumber } from "@/lib/format";
import type { CycleRow, RecoveryRow, SleepRow } from "@/lib/db";

type CardProps = {
  label: string;
  value: string;
  unit?: string;
  color: string;
  tint?: string;
  delta: { label: string; dir: "up" | "down" | "flat" };
  href: string;
};

function KPI({ label, value, unit, color, tint, delta, href }: CardProps) {
  const style = { ["--kpi-tint" as keyof CSSProperties]: tint } as CSSProperties;
  return (
    <Link href={href} className="kpi" style={{ ...style, textDecoration: "none", border: "none" }}>
      <div className="head">
        <span className="lbl">{label}</span>
        <span className="dot" style={{ background: color, color }} />
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

  return (
    <section className="kpi-strip" aria-label="KPIs">
      <KPI
        label="Recovery"
        value={p.latestRecovery?.recovery_score?.toFixed(0) ?? "—"}
        unit="%"
        color="#00d4aa"
        tint="rgba(0,212,170,0.12)"
        delta={formatDelta(p.latestRecovery?.recovery_score ?? null, p.previousRecovery?.recovery_score ?? null, { unit: "", precision: 0 })}
        href="/recovery"
      />
      <KPI
        label="HRV"
        value={p.latestRecovery?.hrv?.toFixed(0) ?? "—"}
        unit="ms"
        color="#7b61ff"
        tint="rgba(123,97,255,0.12)"
        delta={formatDelta(p.latestRecovery?.hrv ?? null, p.previousRecovery?.hrv ?? null, { unit: " ms", precision: 0 })}
        href="/recovery"
      />
      <KPI
        label="RHR"
        value={p.latestRecovery?.rhr?.toFixed(0) ?? "—"}
        unit="bpm"
        color="#ff6b6b"
        tint="rgba(255,107,107,0.08)"
        delta={formatDelta(p.latestRecovery?.rhr ?? null, p.previousRecovery?.rhr ?? null, { unit: " bpm", precision: 0, reverse: true })}
        href="/recovery"
      />
      <KPI
        label="Sleep"
        value={latestSleepHours != null ? latestSleepHours.toFixed(1) : "—"}
        unit="h"
        color="#00d4aa"
        tint="rgba(0,212,170,0.08)"
        delta={formatDelta(latestSleepHours, previousSleepHours, { unit: "h", precision: 1 })}
        href="/sleep"
      />
      <KPI
        label="Strain"
        value={p.latestCycle?.strain?.toFixed(1) ?? "—"}
        unit=""
        color="#ffaa00"
        tint="rgba(255,170,0,0.08)"
        delta={formatDelta(p.latestCycle?.strain ?? null, p.previousCycle?.strain ?? null, { unit: "", precision: 1 })}
        href="/strain"
      />
      <KPI
        label="SpO2"
        value={p.latestRecovery?.spo2?.toFixed(1) ?? "—"}
        unit="%"
        color="#00d4aa"
        tint="rgba(0,212,170,0.08)"
        delta={formatDelta(p.latestRecovery?.spo2 ?? null, p.previousRecovery?.spo2 ?? null, { unit: "%", precision: 1 })}
        href="/recovery"
      />
    </section>
  );
}
