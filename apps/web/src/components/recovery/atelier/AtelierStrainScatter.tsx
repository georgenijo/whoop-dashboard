export type ScatterRow = {
  date: string;
  strain: number | null;
  recovery: number | null;
  sleep_hours: number | null;
};

type ValidPoint = {
  date: string;
  strain: number;
  recovery: number;
  sleep_hours: number | null;
};

type Props = { rows: ScatterRow[] };

function colorFor(p: ValidPoint): string {
  if (p.recovery > 66) return "var(--olive)";
  if (p.recovery < 33 && p.strain > 15) return "var(--coral)";
  return "var(--mustard)";
}

export default function AtelierStrainScatter({ rows }: Props) {
  const valid: ValidPoint[] = rows.filter(
    (r): r is { date: string; strain: number; recovery: number; sleep_hours: number | null } =>
      r.strain != null && Number.isFinite(r.strain) &&
      r.recovery != null && Number.isFinite(r.recovery)
  );

  if (valid.length < 7) {
    return (
      <div className="atelier-recovery-analytic">
        <div className="atelier-plate-head">
          <span className="atelier-plate-fig">FIG. 08 / SR-SCATTER</span>
        </div>
        <p className="atelier-chart-empty">Need 7+ days of strain + recovery data</p>
      </div>
    );
  }

  const STRAIN_MAX = 21;
  const RECOVERY_MAX = 100;
  const redCount = valid.filter((p) => p.recovery < 33 && p.strain > 15).length;

  return (
    <div className="atelier-recovery-analytic">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">FIG. 08 / SR-SCATTER</span>
        <span className="atelier-plate-page">{valid.length} points · 30d</span>
      </div>
      <p className="atelier-recovery-chart-title">
        Strain versus recovery, <em>the training conversation.</em>
      </p>
      <div className="atelier-scatter-wrap">
        <div className="atelier-scatter-axis-y">
          <span>100%</span>
          <span>67%</span>
          <span>33%</span>
          <span>0%</span>
        </div>
        <div className="atelier-chart-body-tall">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {/* zone hairlines */}
            <line x1="0" y1="33" x2="100" y2="33" stroke="var(--line-soft)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
            <line x1="0" y1="67" x2="100" y2="67" stroke="var(--line-soft)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
            {/* strain threshold hairline at strain=15 */}
            <line
              x1={`${(15 / STRAIN_MAX) * 100}`} y1="0"
              x2={`${(15 / STRAIN_MAX) * 100}`} y2="67"
              stroke="var(--line-soft)" strokeWidth="0.5" vectorEffect="non-scaling-stroke"
            />
            {valid.map((p, i) => {
              const cx = (p.strain / STRAIN_MAX) * 100;
              const cy = 100 - (p.recovery / RECOVERY_MAX) * 100;
              const color = colorFor(p);
              return (
                <circle
                  key={`${p.date}-${i}`}
                  cx={cx}
                  cy={cy}
                  r="1.8"
                  fill={color}
                  fillOpacity="0.85"
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{p.date} · strain {p.strain.toFixed(1)} · recovery {p.recovery.toFixed(0)}%</title>
                </circle>
              );
            })}
          </svg>
        </div>
        <div className="atelier-scatter-axis-x">
          <span>0</span>
          <span>5</span>
          <span>10</span>
          <span>15</span>
          <span>21</span>
        </div>
      </div>
      <div className="atelier-scatter-legend">
        <div className="atelier-scatter-legend-item">
          <span className="atelier-scatter-legend-dot" style={{ background: "var(--olive)" }} />
          <span>Green &gt;66%</span>
        </div>
        <div className="atelier-scatter-legend-item">
          <span className="atelier-scatter-legend-dot" style={{ background: "var(--mustard)" }} />
          <span>Moderate</span>
        </div>
        <div className="atelier-scatter-legend-item">
          <span className="atelier-scatter-legend-dot" style={{ background: "var(--coral)" }} />
          <span>Red &lt;33% + high strain</span>
        </div>
      </div>
      {redCount > 0 && (
        <p style={{
          fontFamily: "var(--font-display-sans)",
          fontSize: 11,
          color: "var(--coral)",
          marginTop: 8,
          marginBottom: 0,
        }}>
          {redCount} red-zone {redCount === 1 ? "day" : "days"} — high strain on low recovery.
        </p>
      )}
    </div>
  );
}
