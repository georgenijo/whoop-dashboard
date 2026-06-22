import { recoveryBand, bandColor, bandLabel, bandGuidance } from "./band";

type Props = {
  /** Today's (or latest-available) recovery score, 0-100, or null when no data. */
  score: number | null;
  /** The date the score is for, when it isn't strictly today (fallback). */
  dataDate: string | null;
  isToday: boolean;
};

// Today's REAL recovery band + one-line guidance. Server-rendered. Maps the
// recovery score to hard / moderate / mobility guidance (issue #421 v1 scope).
export default function TodayRecoveryBanner({ score, dataDate, isToday }: Props) {
  if (score == null) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#6b6b74", color: "#6b6b74" }} />
            Today&apos;s readiness
          </div>
        </div>
        <div className="empty-state">
          <div className="title">No recovery score yet</div>
          <div className="sub">Sync Whoop to see today&apos;s training guidance</div>
        </div>
      </div>
    );
  }

  const band = recoveryBand(score);
  const color = bandColor(band);

  return (
    <div
      className="card"
      style={{ borderColor: `color-mix(in srgb, ${color} 30%, transparent)` }}
    >
      <div className="card-head">
        <div className="card-title">
          <span className="dot" style={{ background: color, color }} />
          Today&apos;s readiness
        </div>
        <span
          className="card-sub"
          style={{ color: "var(--fg-3)" }}
        >
          {isToday ? "Today" : dataDate ? `as of ${dataDate}` : ""}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: 6,
            fontFamily: "var(--font-display)",
            fontVariantNumeric: "tabular-nums",
            color,
          }}
        >
          <span style={{ fontSize: 40, fontWeight: 500, letterSpacing: "-0.02em" }}>
            {Math.round(score)}
          </span>
          <span style={{ fontSize: 14, color: "var(--fg-3)" }}>%</span>
        </div>

        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            padding: "4px 11px",
            borderRadius: 9999,
            color,
            background: `color-mix(in srgb, ${color} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
          }}
        >
          {bandLabel(band)} recovery
        </span>

        <p
          style={{
            margin: 0,
            flex: "1 1 220px",
            minWidth: 200,
            fontFamily: "var(--font-sans)",
            fontSize: 13.5,
            lineHeight: 1.5,
            color: "var(--fg-1)",
          }}
        >
          {bandGuidance(band)}
        </p>
      </div>
    </div>
  );
}
