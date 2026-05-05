import { smoothPath, sparklinePoints } from "@/lib/paths";
import type { CycleRow, RecoveryRow, SleepRow } from "@/lib/db";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function deltaLabel(
  latest: number | null | undefined,
  previous: number | null | undefined,
  opts: { unit?: string; precision?: number; reverse?: boolean } = {}
): { label: string; dir: "up" | "down" | "flat" } {
  if (latest == null || previous == null) return { label: "—", dir: "flat" };
  const diff = latest - previous;
  const precision = opts.precision ?? 1;
  const abs = Math.abs(diff);
  if (abs < Math.pow(10, -precision) / 2) return { label: "±0", dir: "flat" };
  const isImprovement = opts.reverse ? diff < 0 : diff > 0;
  const arrow = diff > 0 ? "↑" : "↓";
  return {
    label: `${arrow} ${abs.toFixed(precision)}${opts.unit ?? ""} vs wk`,
    dir: isImprovement ? "up" : "down",
  };
}

// ─── sparkline SVG ──────────────────────────────────────────────────────────

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="atelier-spark" />;
  const pts = sparklinePoints(values, 60, 28);
  const line = smoothPath(pts);
  const area = `${line} L 60,28 L 0,28 Z`;
  return (
    <svg
      viewBox="0 0 60 28"
      className="atelier-spark"
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={`spark-area-${values[0]}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#15140f" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#15140f" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#spark-area-${values[0]})`} />
      <path
        d={line}
        fill="none"
        stroke="#15140f"
        strokeWidth="1"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ─── bar sparkline (strain / steps) ─────────────────────────────────────────

function BarSpark({ values }: { values: number[] }) {
  if (values.length === 0) return <div className="atelier-spark" />;
  const max = Math.max(...values, 1);
  const count = Math.min(values.length, 7);
  const recent = values.slice(-count);
  const barW = 6;
  const gap = 2;
  const totalW = count * barW + (count - 1) * gap;
  return (
    <svg
      viewBox={`0 0 ${totalW} 28`}
      className="atelier-spark"
      preserveAspectRatio="none"
      aria-hidden
    >
      {recent.map((v, i) => {
        const h = Math.max(2, (v / max) * 28);
        const x = i * (barW + gap);
        return (
          <rect
            key={i}
            x={x}
            y={28 - h}
            width={barW}
            height={h}
            rx="1"
            fill="rgba(21,20,15,0.25)"
          />
        );
      })}
    </svg>
  );
}

// ─── single KPI card ────────────────────────────────────────────────────────

type KPICardProps = {
  roman: string;
  label: string;
  value: string;
  unit?: string;
  desc: string;
  delta: { label: string; dir: "up" | "down" | "flat" };
  chart: React.ReactNode;
};

function KPICard({ roman, label, value, unit, desc, delta, chart }: KPICardProps) {
  const deltaColor =
    delta.dir === "up"
      ? "#3b8a5a"
      : delta.dir === "down"
      ? "#ed6f5c"
      : "var(--fg-3)";
  return (
    <div className="atelier-kpi-card">
      <div className="atelier-kpi-top">
        <span className="atelier-kpi-label">{label}</span>
        <span className="atelier-kpi-roman">{roman}</span>
      </div>
      <div className="atelier-kpi-value">
        {value}
        {unit && <span className="atelier-kpi-unit">{unit}</span>}
      </div>
      <div className="atelier-kpi-desc">{desc}</div>
      <div className="atelier-kpi-footer">
        <span className="atelier-kpi-delta" style={{ color: deltaColor }}>
          {delta.label}
        </span>
        {chart}
      </div>
    </div>
  );
}

// ─── main component ──────────────────────────────────────────────────────────

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

export default function AtelierKPIGrid({
  latestRecovery,
  previousRecovery,
  latestCycle,
  previousCycle,
  latestSleep,
  previousSleep,
  recoveryTrend,
  strainTrend,
  sleepTrend,
}: Props) {
  // ── Recovery ──
  const recoveryScore = latestRecovery?.recovery_score ?? null;
  const prevScore = previousRecovery?.recovery_score ?? null;
  const recoveryDesc =
    recoveryScore == null ? "No data"
    : recoveryScore >= 67 ? "Green band"
    : recoveryScore >= 34 ? "Yellow band"
    : "Red band";
  const recoveryValues = recoveryTrend
    .map((r) => r.recovery_score)
    .filter((v): v is number => v != null);

  // ── Strain ──
  const strain = latestCycle?.strain ?? null;
  const prevStrain = previousCycle?.strain ?? null;
  const strainValues = strainTrend
    .map((r) => r.strain)
    .filter((v): v is number => v != null);

  // ── HRV ──
  const hrv = latestRecovery?.hrv ?? null;
  const prevHrv = previousRecovery?.hrv ?? null;
  const hrvValues = recoveryTrend
    .map((r) => r.hrv)
    .filter((v): v is number => v != null);

  // ── RHR ──
  const rhr = latestRecovery?.rhr ?? null;
  const prevRhr = previousRecovery?.rhr ?? null;
  const rhrValues = recoveryTrend
    .map((r) => r.rhr)
    .filter((v): v is number => v != null);

  // ── Sleep performance ──
  const sleepPerf = latestSleep?.performance ?? null;
  const prevSleepPerf = previousSleep?.performance ?? null;
  const sleepPerfValues = sleepTrend
    .map((r) => r.performance)
    .filter((v): v is number => v != null);
  const sleepNeedStr = fmtMs(latestSleep?.sleep_need_ms);
  const sleepGotStr = fmtMs(
    (latestSleep?.in_bed_ms ?? 0) - (latestSleep?.awake_ms ?? 0)
  );
  const sleepDesc = latestSleep ? `Need ${sleepNeedStr} · got ${sleepGotStr}` : "No data";

  // ── Steps — placeholder data ──
  const stepsPlaceholder = [4200, 7800, 5100, 3847, 6500, 8100, 3847];
  const latestSteps = 3847;
  const prevSteps = 5200;
  const stepsDesc = "Goal 8 000";

  // ── Calories (from kilojoules) ──
  const kj = latestCycle?.kilojoule ?? null;
  const prevKj = previousCycle?.kilojoule ?? null;
  const kcal = kj != null ? Math.round(kj / 4.184) : null;
  const prevKcal = prevKj != null ? Math.round(prevKj / 4.184) : null;
  const bmr = 1612;
  const burn = kcal != null ? Math.max(0, kcal - bmr) : null;
  const calDesc = kcal != null ? `BMR ${bmr} · burn ${burn}` : "No data";
  const calValues = strainTrend
    .map((r) => (r.kilojoule != null ? r.kilojoule / 4.184 : null))
    .filter((v): v is number => v != null);

  // ── Respiratory rate ──
  const respRate = latestSleep?.respiratory_rate ?? null;
  const prevRespRate = previousSleep?.respiratory_rate ?? null;
  const respValues = sleepTrend
    .map((r) => r.respiratory_rate)
    .filter((v): v is number => v != null);

  const cards: KPICardProps[] = [
    {
      roman: "i.",
      label: "RECOVERY",
      value: recoveryScore != null ? recoveryScore.toFixed(0) : "—",
      unit: "/100",
      desc: recoveryDesc,
      delta: deltaLabel(recoveryScore, prevScore, { unit: "", precision: 0 }),
      chart: <Sparkline values={recoveryValues} />,
    },
    {
      roman: "ii.",
      label: "DAY STRAIN",
      value: strain != null ? strain.toFixed(1) : "—",
      unit: "/21",
      desc: strain == null ? "No data" : strain >= 18 ? "All out" : strain >= 14 ? "Strenuous" : strain >= 10 ? "Moderate" : "Light",
      delta: deltaLabel(strain, prevStrain, { unit: "", precision: 1 }),
      chart: <BarSpark values={strainValues} />,
    },
    {
      roman: "iii.",
      label: "HRV",
      value: hrv != null ? hrv.toFixed(0) : "—",
      unit: "ms",
      desc: "Above baseline",
      delta: deltaLabel(hrv, prevHrv, { unit: "ms", precision: 0 }),
      chart: <Sparkline values={hrvValues} />,
    },
    {
      roman: "iv.",
      label: "RESTING HR",
      value: rhr != null ? rhr.toFixed(0) : "—",
      unit: "bpm",
      desc: "Resting heart rate",
      delta: deltaLabel(rhr, prevRhr, { unit: "", precision: 0, reverse: true }),
      chart: <Sparkline values={rhrValues} />,
    },
    {
      roman: "v.",
      label: "SLEEP PERFORMANCE",
      value: sleepPerf != null ? sleepPerf.toFixed(0) : "—",
      unit: "%",
      desc: sleepDesc,
      delta: deltaLabel(sleepPerf, prevSleepPerf, { unit: "%", precision: 0 }),
      chart: <Sparkline values={sleepPerfValues} />,
    },
    {
      roman: "vi.",
      label: "DAILY STEPS",
      value: latestSteps.toLocaleString(),
      unit: " steps",
      desc: stepsDesc,
      delta: deltaLabel(latestSteps, prevSteps, { unit: "k", precision: 1 }),
      chart: <BarSpark values={stepsPlaceholder} />,
    },
    {
      roman: "vii.",
      label: "CALORIES",
      value: kcal != null ? kcal.toLocaleString() : "—",
      unit: " kcal",
      desc: calDesc,
      delta: deltaLabel(kcal, prevKcal, { unit: "", precision: 0 }),
      chart: <Sparkline values={calValues} />,
    },
    {
      roman: "viii.",
      label: "RESP. RATE",
      value: respRate != null ? respRate.toFixed(1) : "—",
      unit: " rpm",
      desc: "Stable · 7-day Δ < 0.4",
      delta: deltaLabel(respRate, prevRespRate, { unit: " rpm", precision: 1 }),
      chart: <Sparkline values={respValues} />,
    },
  ];

  return (
    <section className="atelier-kpi-grid" aria-label="KPI metrics grid">
      {cards.map((card) => (
        <KPICard key={card.roman} {...card} />
      ))}
    </section>
  );
}
