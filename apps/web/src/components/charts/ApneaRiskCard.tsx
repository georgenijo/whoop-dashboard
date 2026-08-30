import {
  apneaScoreLabel,
  highRiskNightsCount,
  rollingScoreColor,
  type ApneaRow,
} from "@/lib/analytics/apnea";

type Props = { rows: ApneaRow[]; rangeLabel: string };

const FLAGS = [
  { key: "flag_disturbances" as const, label: "Disturbances >10", color: "#ff6b6b" },
  { key: "flag_spo2" as const, label: "SpO2 <95%", color: "#ffaa00" },
  { key: "flag_resp_rate" as const, label: "Resp Rate Elevated", color: "#00aaff" },
  { key: "flag_deep_sleep" as const, label: "Deep Sleep <15%", color: "#7b61ff" },
];

function pickAxisLabels(dates: string[]): string[] {
  if (dates.length === 0) return [];
  const idx = [
    0,
    Math.floor(dates.length / 4),
    Math.floor(dates.length / 2),
    Math.floor((dates.length * 3) / 4),
    dates.length - 1,
  ];
  return Array.from(new Set(idx)).map((i) =>
    new Date(dates[i] + "T00:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  );
}

export default function ApneaRiskCard({ rows, rangeLabel }: Props) {
  const caption = "Screening signal only — not a medical diagnosis";

  if (rows.length === 0) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: "#ff8c00", color: "#ff8c00" }} />
              Sleep Apnea Risk Signal
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>{rangeLabel} · {caption}</div>
          </div>
        </div>
        <div className="empty-state">
          <div className="title">No sleep data yet</div>
          <div className="sub">Sync Whoop to populate this card</div>
        </div>
      </div>
    );
  }

  const latest = rows[rows.length - 1];
  const score = latest.apnea_score;
  const rolling = latest.apnea_score_7d;
  const highRisk14d = highRiskNightsCount(rows, 14);
  const noSpo2 = rows.every((r) => !r.has_spo2);

  const dates = rows.map((r) => r.date);
  const axis = pickAxisLabels(dates);

  // Chart 1: 7-night rolling bars
  // Y-axis fixed at 28 (theoretical max with 4 flags x 7 nights)
  const ROLLING_MAX = 28;
  const barWidth = 100 / Math.max(rows.length, 1);
  const thresholdY = 100 - (7 / ROLLING_MAX) * 100;

  // Chart 2: Stacked nightly flags, y-axis 0..4
  const FLAG_MAX = 4;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#ff8c00", color: "#ff8c00" }} />
            Sleep Apnea Risk Signal
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>{rangeLabel} · {caption}</div>
        </div>
      </div>

      {noSpo2 && (
        <div className="card-sub" style={{ marginBottom: 12 }}>
          SpO2 data unavailable (WHOOP 4.0+) — apnea score uses 3 of 4 indicators.
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <Kpi
          label="Tonight's Risk Score"
          value={`${score}/4`}
          sub={apneaScoreLabel(score)}
        />
        <Kpi
          label="7-Night Rolling Score"
          value={`${rolling}/28`}
          sub="cumulative flags"
        />
        <Kpi
          label="High-Risk Nights (14d)"
          value={`${highRisk14d}`}
          sub="score ≥ 2"
        />
      </div>

      <div style={{ marginBottom: 24 }}>
        <div
          className="card-sub"
          style={{ marginBottom: 6, color: "var(--fg-2)" }}
        >
          7-Night Rolling Score
        </div>
        <div className="chart-body" style={{ position: "relative" }}>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
          >
            <line
              x1="0"
              y1="33"
              x2="100"
              y2="33"
              stroke="rgba(255,255,255,0.04)"
              strokeDasharray="0.3 0.6"
              strokeWidth="0.2"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1="0"
              y1="66"
              x2="100"
              y2="66"
              stroke="rgba(255,255,255,0.04)"
              strokeDasharray="0.3 0.6"
              strokeWidth="0.2"
              vectorEffect="non-scaling-stroke"
            />
            {rows.map((r, i) => {
              const h = (r.apnea_score_7d / ROLLING_MAX) * 100;
              return (
                <rect
                  key={r.date}
                  x={i * barWidth + barWidth * 0.1}
                  y={100 - h}
                  width={barWidth * 0.8}
                  height={h}
                  fill={rollingScoreColor(r.apnea_score_7d)}
                  opacity={0.85}
                />
              );
            })}
            <line
              x1="0"
              y1={thresholdY}
              x2="100"
              y2={thresholdY}
              stroke="rgba(255,255,255,0.45)"
              strokeWidth="0.4"
              strokeDasharray="1.5 1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
        <div className="chart-axis">
          {axis.map((label, i) => (
            <span key={`${label}-${i}`}>{label}</span>
          ))}
        </div>
      </div>

      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <div className="card-sub" style={{ color: "var(--fg-2)" }}>
            Nightly Flags
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {FLAGS.map((f) => (
              <span
                key={f.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--fg-3)",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: f.color,
                    display: "inline-block",
                  }}
                />
                {f.label}
              </span>
            ))}
          </div>
        </div>
        <div className="chart-body" style={{ position: "relative", height: 140 }}>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}
          >
            {rows.map((r, i) => {
              let stackOffset = 0;
              return (
                <g key={r.date}>
                  {FLAGS.map((f) => {
                    const v = r[f.key];
                    if (v === 0) return null;
                    const h = (1 / FLAG_MAX) * 100;
                    const y = 100 - stackOffset - h;
                    stackOffset += h;
                    return (
                      <rect
                        key={f.key}
                        x={i * barWidth + barWidth * 0.1}
                        y={y}
                        width={barWidth * 0.8}
                        height={h}
                        fill={f.color}
                        opacity={0.85}
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>
        </div>
        <div className="chart-axis">
          {axis.map((label, i) => (
            <span key={`${label}-${i}`}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "10px 12px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 10,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--fg-3)",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 22,
          fontWeight: 500,
          color: "var(--fg-1)",
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--fg-3)",
        }}
      >
        {sub}
      </span>
    </div>
  );
}
