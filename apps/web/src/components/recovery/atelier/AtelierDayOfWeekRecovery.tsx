import type { DayOfWeekRecoveryRow } from "@/lib/db";

type Props = { rows: DayOfWeekRecoveryRow[] };

const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type DaySeries = {
  label: string;
  avg: number;
  count: number;
};

function buildSeries(rows: DayOfWeekRecoveryRow[]): DaySeries[] {
  const byDow = new Map(rows.map((r) => [r.dow, r] as const));
  return DAY_SHORT.map((label, i) => {
    // SQLite dow: 0=Sunday,1=Monday..6=Saturday; i=0 → Monday → sqlite=1
    const sqliteDow = (i + 1) % 7;
    const row = byDow.get(sqliteDow);
    return {
      label,
      avg: row ? Number(row.avg.toFixed(1)) : 0,
      count: row?.count ?? 0,
    };
  });
}

function colorFor(avg: number): string {
  if (avg >= 67) return "var(--olive)";
  if (avg <= 33) return "var(--coral)";
  return "var(--mustard)";
}

export default function AtelierDayOfWeekRecovery({ rows }: Props) {
  const series = buildSeries(rows);
  const totalDays = series.reduce((acc, d) => acc + d.count, 0);

  if (totalDays === 0) {
    return (
      <div className="atelier-recovery-analytic">
        <div className="atelier-plate-head">
          <span className="atelier-plate-fig">FIG. 09 / DOW-90</span>
        </div>
        <p className="atelier-chart-empty">No recovery data by day of week</p>
      </div>
    );
  }

  const maxAvg = Math.max(...series.map((d) => d.avg), 1);

  return (
    <div className="atelier-recovery-analytic">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">FIG. 09 / DOW-90</span>
        <span className="atelier-plate-page">90-day average · {totalDays} days</span>
      </div>
      <p className="atelier-recovery-chart-title">
        Recovery by day of week, <em>the weekly rhythm.</em>
      </p>
      <div className="atelier-dow-bars">
        {series.map((d) => {
          const heightPct = d.count > 0 ? (d.avg / maxAvg) * 100 : 4;
          const color = d.count > 0 ? colorFor(d.avg) : "var(--line)";
          return (
            <div key={d.label} className="atelier-dow-col">
              {d.count > 0 && (
                <span className="atelier-dow-val">{d.avg.toFixed(0)}</span>
              )}
              <div
                className={`atelier-dow-bar${d.count === 0 ? " empty" : ""}`}
                style={{
                  height: `${heightPct}%`,
                  background: color,
                }}
                title={d.count > 0 ? `${d.label}: avg ${d.avg.toFixed(1)}% (${d.count} days)` : `${d.label}: no data`}
              />
            </div>
          );
        })}
      </div>
      <div className="atelier-dow-axis">
        {series.map((d) => (
          <span key={d.label} className="atelier-dow-label">{d.label}</span>
        ))}
      </div>
    </div>
  );
}
