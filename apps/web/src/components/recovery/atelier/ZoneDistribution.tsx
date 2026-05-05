import { recoveryZone } from "@/lib/format";
import type { RecoveryRow } from "@/lib/db";

type Props = { rows: RecoveryRow[] };

export default function ZoneDistribution({ rows }: Props) {
  const scored = rows.filter((r) => r.recovery_score != null);
  const total = scored.length || 1;

  const counts = scored.reduce(
    (acc, r) => {
      const z = recoveryZone(r.recovery_score);
      acc[z]++;
      return acc;
    },
    { green: 0, yellow: 0, red: 0 }
  );

  const pct = (n: number) => Math.round((n / total) * 100);
  const greenPct = pct(counts.green);
  const yellowPct = pct(counts.yellow);
  const redPct = pct(counts.red);

  const zones = [
    { roman: "i", label: "Green — primed", count: counts.green, pct: greenPct, color: "#6e7448" },
    { roman: "ii", label: "Yellow — moderate", count: counts.yellow, pct: yellowPct, color: "#e9b94a" },
    { roman: "iii", label: "Red — rest", count: counts.red, pct: redPct, color: "#ed6f5c" },
  ];

  return (
    <div className="atelier-recovery-zone-dist">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">FIG. 05 / ZD-30</span>
        <span className="atelier-plate-page">30-day distribution</span>
      </div>
      <p className="atelier-recovery-chart-title">
        Zone distribution, <em>thirty mornings classified.</em>
      </p>
      <div className="atelier-zone-stacked-bar">
        {zones.map((z) => (
          <div
            key={z.roman}
            className="atelier-zone-bar-seg"
            style={{ width: `${z.pct}%`, background: z.color }}
            title={`${z.label}: ${z.count}`}
          />
        ))}
      </div>
      <div className="atelier-zone-legend">
        {zones.map((z) => (
          <div key={z.roman} className="atelier-zone-legend-row">
            <span className="atelier-zone-roman">{z.roman}.</span>
            <span className="atelier-zone-dot" style={{ background: z.color }} />
            <span className="atelier-zone-label">{z.label}</span>
            <span className="atelier-zone-count">{z.count} <span className="atelier-zone-pct">({z.pct}%)</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}
