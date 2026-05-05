import { fmtMs } from "@/lib/atelier-format";
import type { SleepRow } from "@/lib/db";

type Props = { latest: SleepRow | null };

export default function SleepHero({ latest }: Props) {
  const performance = latest?.performance != null ? `${latest.performance.toFixed(0)}%` : "—";
  const totalSleep = fmtMs(
    latest != null ? (latest.in_bed_ms ?? 0) - (latest.awake_ms ?? 0) : null
  );
  const efficiency =
    latest?.efficiency != null ? `${latest.efficiency.toFixed(0)}%` : "—";
  // latency_ms not yet stored — renders — until column lands
  // TODO: replace when latency_ms column is added to sleep table
  const latency = "—";

  const kpis = [
    { roman: "I", label: "PERFORMANCE", value: performance },
    { roman: "II", label: "TOTAL SLEEP", value: totalSleep },
    { roman: "III", label: "EFFICIENCY", value: efficiency },
    { roman: "IV", label: "LATENCY", value: latency },
  ];

  return (
    <div className="atelier-sleep-hero">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">I. Sleep / Plate N&#xba; 01</span>
        <span className="atelier-plate-page">001 / 008</span>
      </div>
      <h2 className="atelier-sleep-headline">
        The night, <em>recorded.</em>
      </h2>
      <div className="atelier-sleep-kpi-row">
        {kpis.map((k) => (
          <div key={k.roman} className="atelier-sleep-kpi-card">
            <span className="atelier-sleep-kpi-roman">{k.roman}</span>
            <span className="atelier-sleep-kpi-label">{k.label}</span>
            <span className="atelier-sleep-kpi-value">{k.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
