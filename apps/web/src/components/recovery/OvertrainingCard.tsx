import { computeOTS, type OTSResult } from "@/lib/analytics/ots";
import type { CycleRow, RecoveryRow } from "@/lib/db";

type Props = {
  recovery: RecoveryRow[];
  cycles: CycleRow[];
};

export default function OvertrainingCard({ recovery, cycles }: Props) {
  const result = computeOTS(recovery, cycles);

  if (!result) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: "#6b6b74", color: "#6b6b74" }} />
              Overtraining score
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>Last 7 days</div>
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Need 7+ days of recovery + strain data</div>
          <div className="sub">Sync Whoop to populate this signal</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: result.color, color: result.color }} />
            Overtraining score
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>Last 7 days</div>
        </div>
        <ScoreBadge score={result.score} color={result.color} />
      </div>

      <div
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          color: "var(--fg-1)",
          lineHeight: 1.5,
          padding: "10px 12px",
          marginBottom: 14,
          borderRadius: 10,
          background: `${result.color}10`,
          border: `1px solid ${result.color}33`,
        }}
      >
        {result.label}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SlopeRow
          name="HRV"
          slope={result.slopes.hrv}
          unit="ms/day"
          firing={result.signals.hrv}
          firingDirection="down"
        />
        <SlopeRow
          name="RHR"
          slope={result.slopes.rhr}
          unit="bpm/day"
          firing={result.signals.rhr}
          firingDirection="up"
        />
        <SlopeRow
          name="Recovery"
          slope={result.slopes.recovery}
          unit="%/day"
          firing={result.signals.recovery}
          firingDirection="down"
        />
        <SlopeRow
          name="Strain"
          slope={result.slopes.strain}
          unit="/day"
          firing={!result.signals.strainElevated}
          firingLabel={result.signals.strainElevated ? "sustained" : "dropping"}
          neutralPill
        />
      </div>

      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 11.5,
          color: "var(--fg-3)",
          lineHeight: 1.5,
          margin: "14px 0 0",
        }}
      >
        Score only fires when strain is sustained or rising (slope ≥ −0.1). A drop in strain resets
        the gate even if HRV, RHR, and recovery are all trending the wrong way.
      </p>
    </div>
  );
}

function ScoreBadge({ score, color }: { score: OTSResult["score"]; color: string }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 4,
        padding: "6px 12px",
        borderRadius: 9999,
        background: `${color}1a`,
        border: `1px solid ${color}55`,
        fontFamily: "var(--font-display)",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "-0.01em",
        color,
      }}
    >
      <span style={{ fontSize: 22, fontWeight: 500 }}>{score}</span>
      <span style={{ fontSize: 11, color: "var(--fg-3)" }}>/ 3</span>
    </div>
  );
}

type SlopeRowProps = {
  name: string;
  slope: number;
  unit: string;
  firing: boolean;
  firingDirection?: "up" | "down";
  firingLabel?: string;
  neutralPill?: boolean;
};

function SlopeRow({ name, slope, unit, firing, firingDirection, firingLabel, neutralPill }: SlopeRowProps) {
  const arrow = slope > 0.001 ? "↑" : slope < -0.001 ? "↓" : "→";
  const arrowColor =
    firingDirection === "down"
      ? slope < 0
        ? "#ff6b6b"
        : "#00d4aa"
      : firingDirection === "up"
        ? slope > 0
          ? "#ff6b6b"
          : "#00d4aa"
        : "var(--fg-2)";

  const pillLabel = firingLabel ?? (firing ? "firing" : "ok");
  const pillColor = neutralPill
    ? firing
      ? "#ffaa00"
      : "var(--fg-2)"
    : firing
      ? "#ff6b6b"
      : "#00d4aa";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 8,
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: "var(--fg-2)",
          minWidth: 70,
        }}
      >
        {name}
      </span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 16,
          color: arrowColor,
          width: 14,
          textAlign: "center",
        }}
      >
        {arrow}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--fg-1)",
          fontVariantNumeric: "tabular-nums",
          flex: 1,
        }}
      >
        {formatSlope(slope)} {unit}
      </span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          padding: "3px 8px",
          borderRadius: 9999,
          color: pillColor,
          background: `color-mix(in srgb, ${pillColor} 12%, transparent)`,
          border: `1px solid color-mix(in srgb, ${pillColor} 40%, transparent)`,
        }}
      >
        {pillLabel}
      </span>
    </div>
  );
}

function formatSlope(n: number): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}
