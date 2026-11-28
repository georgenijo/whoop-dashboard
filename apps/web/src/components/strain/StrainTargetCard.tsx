import { bandColor } from "@/components/plans/band";
import {
  STRAIN_SCALE_MAX,
  strainProgress,
  type StrainTarget,
} from "@/lib/analytics/strainTarget";

const ACCENT = "#ffaa00";

type Props = {
  target: StrainTarget;
  /** Today's day strain so far (null when nothing recorded yet). */
  strainSoFar: number | null;
  /** Where `strainSoFar` came from — "workouts" means a lower bound. */
  strainSource: "cycle" | "workouts" | null;
  /** Today's workout count, from getTodayStrainAggregate. */
  workoutCount: number;
};

const pct = (v: number) =>
  `${(Math.min(Math.max(v, 0), STRAIN_SCALE_MAX) / STRAIN_SCALE_MAX) * 100}%`;

const PROGRESS_COPY = {
  none: "No strain recorded yet today.",
  below: "Below target so far.",
  in: "In the target range.",
  above: "Above target — consider winding down.",
} as const;

export default function StrainTargetCard({
  target,
  strainSoFar,
  strainSource,
  workoutCount,
}: Props) {
  return (
    <section className="card" aria-label="Today's strain target" data-testid="strain-target-card">
      <div className="card-head">
        <div className="card-title">
          <span className="dot" style={{ background: ACCENT, color: ACCENT }} />
          Today&apos;s strain target
        </div>
        {target.status === "ok" && (
          <span className="card-sub" style={{ color: bandColor(target.band) }}>
            {target.zone.label}
            {target.cap === "illness" ? " · illness cap" : target.cap === "overtraining" ? " · overtraining cap" : ""}
          </span>
        )}
      </div>

      {target.status === "unavailable" ? (
        <p style={{ margin: 0, color: "var(--fg-2)", fontSize: 13 }}>{target.reason}</p>
      ) : (
        <Body
          target={target}
          strainSoFar={strainSoFar}
          strainSource={strainSource}
          workoutCount={workoutCount}
        />
      )}

      <p
        style={{
          margin: "10px 0 0",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--fg-3)",
          letterSpacing: "0.02em",
        }}
      >
        Guidance only, not medical advice. Listen to your body.
      </p>
    </section>
  );
}

function Body({
  target,
  strainSoFar,
  strainSource,
  workoutCount,
}: Props & { target: Extract<StrainTarget, { status: "ok" }> }) {
  const progress = strainProgress(strainSoFar, target.low, target.high);
  const fillColor =
    progress === "above" ? "var(--danger)" : progress === "in" ? "var(--success)" : ACCENT;
  const soFarLabel =
    strainSoFar == null
      ? "—"
      : `${strainSource === "workouts" ? "≥ " : ""}${strainSoFar.toFixed(1)}`;

  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 34,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            color: ACCENT,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1.05,
          }}
          data-testid="strain-target-range"
        >
          {target.low}–{target.high}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-2)" }}>
          so far <span style={{ color: "var(--fg-1)", fontVariantNumeric: "tabular-nums" }} data-testid="strain-so-far">{soFarLabel}</span>
          {" · "}
          {workoutCount === 1 ? "1 workout" : `${workoutCount} workouts`}
        </div>
      </div>

      <div
        role="meter"
        aria-label="Strain so far versus target"
        aria-valuemin={0}
        aria-valuemax={STRAIN_SCALE_MAX}
        aria-valuenow={strainSoFar ?? 0}
        aria-valuetext={`${soFarLabel} of target ${target.low} to ${target.high}`}
        style={{
          position: "relative",
          height: 10,
          marginTop: 12,
          borderRadius: 999,
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}
      >
        <div
          data-testid="strain-target-band"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: pct(target.low),
            width: `calc(${pct(target.high)} - ${pct(target.low)})`,
            background: "rgba(255,170,0,0.22)",
            borderLeft: "1px solid rgba(255,170,0,0.6)",
            borderRight: "1px solid rgba(255,170,0,0.6)",
          }}
        />
        {strainSoFar != null && (
          <div
            data-testid="strain-so-far-fill"
            style={{
              position: "absolute",
              top: 2,
              bottom: 2,
              left: 0,
              width: pct(strainSoFar),
              borderRadius: 999,
              background: fillColor,
            }}
          />
        )}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 4,
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          color: "var(--fg-3)",
        }}
      >
        <span>0</span>
        <span>{STRAIN_SCALE_MAX}</span>
      </div>

      <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--fg-1)" }} data-testid="strain-target-reason">
        {target.reason}
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--fg-2)" }} data-testid="strain-progress">
        {PROGRESS_COPY[progress]}
      </p>
    </>
  );
}
