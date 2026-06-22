import { recoveryBand, bandColor } from "./band";

export type ReadinessDay = {
  date: string; // YYYY-MM-DD
  /** Short weekday label, e.g. "Mon". */
  label: string;
  score: number | null;
  isToday: boolean;
};

type Props = { days: ReadinessDay[] };

// 7-day readiness strip from the user's REAL last-7-days recovery scores,
// colored by band. Replaces the mock's per-day "session" copy (which was a
// schedule engine — out of v1 scope) with the recovery score itself.
export default function ReadinessStrip({ days }: Props) {
  const hasAny = days.some((d) => d.score != null);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "var(--metric-recovery)", color: "var(--metric-recovery)" }} />
            7-day readiness
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>Recovery by day</div>
        </div>
      </div>

      {!hasAny ? (
        <div className="empty-state">
          <div className="title">No recovery data in the last 7 days</div>
          <div className="sub">Sync Whoop to populate this strip</div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, overflowX: "auto", paddingBottom: 4 }}>
            {days.map((d) => {
              const has = d.score != null;
              const band = has ? recoveryBand(d.score as number) : null;
              const color = band ? bandColor(band) : "var(--fg-3)";
              return (
                <div
                  key={d.date}
                  style={{
                    flex: "1 1 0",
                    minWidth: 84,
                    background: d.isToday ? "rgba(255,255,255,0.04)" : "transparent",
                    border: `1px solid ${
                      d.isToday
                        ? `color-mix(in srgb, ${color} 45%, transparent)`
                        : "rgba(255,255,255,0.06)"
                    }`,
                    borderRadius: 12,
                    padding: "12px 10px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 8,
                    position: "relative",
                  }}
                >
                  {d.isToday && (
                    <span
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 7,
                        fontFamily: "var(--font-mono)",
                        fontSize: 8.5,
                        fontWeight: 700,
                        letterSpacing: "0.08em",
                        color,
                      }}
                    >
                      TODAY
                    </span>
                  )}
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: "0.1em",
                      textTransform: "uppercase",
                      color: "var(--fg-3)",
                    }}
                  >
                    {d.label}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-display)",
                      fontVariantNumeric: "tabular-nums",
                      fontSize: 22,
                      fontWeight: 500,
                      color,
                    }}
                  >
                    {has ? Math.round(d.score as number) : "—"}
                  </span>
                  <span
                    aria-hidden
                    style={{
                      width: "100%",
                      height: 4,
                      borderRadius: 9999,
                      background: has
                        ? `color-mix(in srgb, ${color} 70%, transparent)`
                        : "rgba(255,255,255,0.08)",
                    }}
                  />
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              gap: 18,
              marginTop: 14,
              flexWrap: "wrap",
              fontFamily: "var(--font-sans)",
              fontSize: 11.5,
              color: "var(--fg-3)",
            }}
          >
            <LegendDot color="var(--success)" text="High → hard" />
            <LegendDot color="var(--warning)" text="Mid → moderate" />
            <LegendDot color="var(--danger)" text="Low → mobility / rest" />
          </div>
        </>
      )}
    </div>
  );
}

function LegendDot({ color, text }: { color: string; text: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 9999,
          background: color,
          boxShadow: `0 0 8px color-mix(in srgb, ${color} 40%, transparent)`,
          flex: "none",
        }}
      />
      {text}
    </span>
  );
}
