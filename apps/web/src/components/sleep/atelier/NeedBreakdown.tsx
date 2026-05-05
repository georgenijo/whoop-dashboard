import { fmtMs } from "@/lib/atelier-format";
import type { SleepRow } from "@/lib/db";

type Props = { latest: SleepRow | null };

const COMPONENTS = [
  { roman: "i", label: "BASELINE", key: "need_from_baseline_ms" as const, color: "#2a3a5c" },
  { roman: "ii", label: "DEBT", key: "need_from_debt_ms" as const, color: "#4a4a6a" },
  { roman: "iii", label: "STRAIN", key: "need_from_strain_ms" as const, color: "#8b8696" },
  { roman: "iv", label: "NAP CREDIT", key: "need_from_nap_ms" as const, color: "#ed6f5c" },
];

export default function NeedBreakdown({ latest }: Props) {
  const vals = COMPONENTS.map((c) => latest?.[c.key] ?? 0);
  const total = vals.reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="atelier-sleep-need">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">FIG. 04 / SL-26</span>
        <span className="atelier-plate-page">sleep need decomposition</span>
      </div>

      {/* stacked horizontal bar */}
      <div className="atelier-need-bar" aria-label="Sleep need components">
        {COMPONENTS.map((c, i) => {
          const pct = (vals[i] / total) * 100;
          return (
            <div
              key={c.key}
              style={{ flex: pct, background: c.color, minWidth: pct > 0 ? 2 : 0 }}
              title={`${c.label}: ${fmtMs(vals[i])}`}
            />
          );
        })}
      </div>

      {/* legend */}
      <div className="atelier-need-legend">
        {COMPONENTS.map((c, i) => (
          <div key={c.key} className="atelier-need-legend-row">
            <span className="atelier-stages-roman">{c.roman}</span>
            <span className="atelier-stages-dot" style={{ background: c.color }} />
            <span className="atelier-stages-legend-label">{c.label}</span>
            <span className="atelier-stages-legend-val">{fmtMs(vals[i])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
