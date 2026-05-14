import { kJToKcal } from "@/lib/format";

const STRAIN_COLOR = "#ffaa00";
const HR_COLOR = "#ff6b6b";

type Props = {
  totalKilojoule: number | null;
  avgHr: number | null;
  maxHr: number | null;
  workoutCount: number;
};

function formatInt(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString();
}

export default function TodayKpis({
  totalKilojoule,
  avgHr,
  maxHr,
  workoutCount,
}: Props) {
  const kcal = kJToKcal(totalKilojoule);
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <span
            className="dot"
            style={{ background: STRAIN_COLOR, color: STRAIN_COLOR }}
          />
          Today
        </div>
        <span className="card-sub">
          {workoutCount === 0
            ? "no workouts logged"
            : workoutCount === 1
              ? "1 workout"
              : `${workoutCount} workouts`}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        <Tile
          label="Calories"
          value={formatInt(kcal)}
          unit="kcal"
          subscript={
            totalKilojoule != null
              ? `${formatInt(totalKilojoule)} kJ`
              : null
          }
          color={STRAIN_COLOR}
        />
        <Tile
          label="Avg HR"
          value={avgHr != null ? Math.round(avgHr).toString() : "—"}
          unit="bpm"
          color={HR_COLOR}
        />
        <Tile
          label="Max HR"
          value={maxHr != null ? Math.round(maxHr).toString() : "—"}
          unit="bpm"
          color={HR_COLOR}
        />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  unit,
  subscript,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  subscript?: string | null;
  color: string;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 12,
        background: "rgba(255,255,255,0.025)",
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color: "var(--fg-2)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          marginTop: 6,
          fontFamily: "var(--font-display)",
          fontSize: 26,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          color,
          lineHeight: 1.05,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
        <span
          style={{
            color: "var(--fg-3)",
            fontSize: 12,
            marginLeft: 4,
            fontWeight: 400,
          }}
        >
          {unit}
        </span>
      </div>
      {subscript && (
        <div
          style={{
            marginTop: 3,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--fg-3)",
            letterSpacing: "0.02em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {subscript}
        </div>
      )}
    </div>
  );
}
