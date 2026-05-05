import { fmtMs } from "@/lib/atelier-format";
import type { SleepRow } from "@/lib/db";

type Props = { latest: SleepRow | null };

const STAGES = [
  { roman: "i", label: "DEEP", color: "#2a3a5c", key: "deep_ms" as const },
  { roman: "ii", label: "REM", color: "#4a4a6a", key: "rem_ms" as const },
  { roman: "iii", label: "LIGHT", color: "#8b8696", key: "light_ms" as const },
  { roman: "iv", label: "AWAKE", color: "#ed6f5c", key: "awake_ms" as const },
];

export default function StagesPlate({ latest }: Props) {
  const deep = latest?.deep_ms ?? 0;
  const rem = latest?.rem_ms ?? 0;
  const light = latest?.light_ms ?? 0;
  const awake = latest?.awake_ms ?? 0;
  const total = deep + rem + light + awake || 1;

  const pcts = { deep_ms: deep / total, rem_ms: rem / total, light_ms: light / total, awake_ms: awake / total };

  const dateRange =
    latest?.start_local && latest?.end_local
      ? `${latest.start_local} → ${latest.end_local}`
      : "No data";

  const efficiency = latest?.efficiency != null ? `${latest.efficiency.toFixed(0)}%` : "—";
  const disturbances = latest?.disturbances != null ? String(latest.disturbances) : "—";

  return (
    <div className="atelier-stages-plate">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">FIG. 01 / SL-26</span>
        <span className="atelier-plate-page">{dateRange}</span>
      </div>
      <p className="atelier-stages-headline">The night, <em>recorded.</em></p>

      {/* proportional bar */}
      <div className="atelier-stages-bar" aria-label="Sleep stage proportions">
        {STAGES.map((s) => {
          const pct = pcts[s.key] * 100;
          return (
            <div
              key={s.key}
              style={{ flex: pct, background: s.color, minWidth: pct > 0 ? 2 : 0 }}
              title={`${s.label}: ${fmtMs(latest?.[s.key])}`}
            />
          );
        })}
      </div>

      {/* legend */}
      <div className="atelier-stages-legend">
        {STAGES.map((s) => (
          <div key={s.key} className="atelier-stages-legend-row">
            <span className="atelier-stages-roman">{s.roman}</span>
            <span className="atelier-stages-dot" style={{ background: s.color }} />
            <span className="atelier-stages-legend-label">{s.label}</span>
            <span className="atelier-stages-legend-val">{fmtMs(latest?.[s.key])}</span>
          </div>
        ))}
      </div>

      {/* stats */}
      <div className="atelier-stages-stats">
        <span>Efficiency <strong>{efficiency}</strong></span>
        <span className="atelier-sep">·</span>
        <span>Disturbances <strong>{disturbances}</strong></span>
        <span className="atelier-sep">·</span>
        {/* latency_ms not yet in schema */}
        <span>Latency <strong>—</strong></span>
      </div>
    </div>
  );
}
