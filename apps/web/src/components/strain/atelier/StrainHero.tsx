import type { CycleRow } from "@/lib/db";

type Props = {
  latest: CycleRow | null;
  prev: CycleRow | null;
  trend30: CycleRow[];
};

function mean(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export default function StrainHero({ latest, trend30 }: Props) {
  const strain = latest?.strain ?? 0;
  const max = 21;
  const r = 50;
  const circ = 2 * Math.PI * r;
  const dash = (strain / max) * circ;

  const last7 = trend30.slice(-7).map((r) => r.strain).filter((v): v is number => v != null);
  const prev7 = trend30.slice(-14, -7).map((r) => r.strain).filter((v): v is number => v != null);
  const weekAvg = mean(last7);
  const prevWeekAvg = mean(prev7);
  const weekDelta = prev7.length ? weekAvg - prevWeekAvg : null;

  const hrVals = trend30.map((r) => ({ hr: r.max_hr ?? 0, date: r.date }));
  const maxHrEntry = hrVals.reduce(
    (best, cur) => (cur.hr > best.hr ? cur : best),
    { hr: 0, date: "" }
  );

  const totalKj = trend30.reduce((s, r) => s + (r.kilojoule ?? 0), 0);
  const totalKcal = totalKj / 4.184;
  const avgKcalPerDay = trend30.length ? totalKcal / trend30.length : 0;

  const strainDeltaVsPrev7 = last7.length && prev7.length
    ? mean(last7.slice(-1)) - prevWeekAvg
    : null;

  const fmtDelta = (d: number | null, decimals = 1) => {
    if (d == null) return null;
    const sign = d > 0 ? "+" : "";
    return `${sign}${d.toFixed(decimals)}`;
  };

  const fmtDate = (dateStr: string) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const weekDeltaStr = fmtDelta(weekDelta);

  return (
    <div className="atelier-strain-hero">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">I. Strain / Plate N&#xba; 01</span>
        <span className="atelier-plate-page">001 / 008</span>
      </div>
      <h2 className="atelier-strain-headline">
        The body, <em>loaded.</em>
      </h2>
      <div className="atelier-strain-hero-body">
        <div className="atelier-strain-ring-wrap">
          <svg
            className="atelier-strain-ring-svg"
            viewBox="0 0 120 120"
            aria-label={`Strain ${strain.toFixed(1)} of 21`}
          >
            <circle
              cx="60"
              cy="60"
              r={r}
              stroke="var(--line)"
              strokeWidth="6"
              fill="none"
            />
            <circle
              cx="60"
              cy="60"
              r={r}
              stroke="#ed6f5c"
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circ}`}
              transform="rotate(-90 60 60)"
              fill="none"
            />
            <text
              x="60"
              y="55"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{
                fontFamily: "var(--font-display-sans)",
                fontSize: "22px",
                fontWeight: 800,
                fill: "var(--ink)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {strain.toFixed(1)}
            </text>
            <text
              x="60"
              y="72"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{
                fontFamily: "var(--font-display-sans)",
                fontSize: "9px",
                fontWeight: 600,
                fill: "var(--ink-faint)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              / 21
            </text>
          </svg>
          <div className="atelier-strain-ring-label">TODAY</div>
        </div>
        <div className="atelier-strain-kpi-row">
          <div className="atelier-strain-kpi-card">
            <span className="atelier-strain-kpi-roman">I</span>
            <span className="atelier-strain-kpi-label">WEEKLY AVG</span>
            <span className="atelier-strain-kpi-value">{weekAvg.toFixed(1)}</span>
            {weekDeltaStr && (
              <span className={`atelier-strain-kpi-delta ${weekDelta! > 0 ? "up" : "down"}`}>
                {weekDeltaStr} vs prior 7d
              </span>
            )}
          </div>
          <div className="atelier-strain-kpi-card">
            <span className="atelier-strain-kpi-roman">II</span>
            <span className="atelier-strain-kpi-label">MAX HR (30D)</span>
            <span className="atelier-strain-kpi-value">
              {maxHrEntry.hr > 0 ? `${maxHrEntry.hr}` : "—"}
            </span>
            {maxHrEntry.date && (
              <span className="atelier-strain-kpi-delta flat">{fmtDate(maxHrEntry.date)}</span>
            )}
          </div>
          <div className="atelier-strain-kpi-card">
            <span className="atelier-strain-kpi-roman">III</span>
            <span className="atelier-strain-kpi-label">30D BURN</span>
            <span className="atelier-strain-kpi-value">
              {totalKcal > 0 ? `${Math.round(totalKcal).toLocaleString()}` : "—"}
            </span>
            {avgKcalPerDay > 0 && (
              <span className="atelier-strain-kpi-delta flat">
                ~{Math.round(avgKcalPerDay)} kcal/day
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
