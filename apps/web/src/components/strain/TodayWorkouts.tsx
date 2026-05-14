import { sportColor } from "@/lib/sport-color";
import type { TodayWorkoutRow } from "@/lib/db";

const STRAIN_COLOR = "#ffaa00";

// lucide-static icon name per sport. Unknowns fall back to "activity".
// Keep keys lowercase — sport names from Whoop are mixed-case.
const SPORT_ICON: Record<string, string> = {
  running: "footprints",
  walking: "footprints",
  hiking: "mountain",
  cycling: "bike",
  swimming: "waves",
  rowing: "rowing-boat",
  weightlifting: "dumbbell",
  strength: "dumbbell",
  "functional fitness": "dumbbell",
  yoga: "flower",
  pilates: "flower",
  meditation: "brain",
  basketball: "circle-dot",
  soccer: "circle-dot",
  tennis: "circle-dot",
  golf: "flag",
  skiing: "snowflake",
  snowboarding: "snowflake",
  boxing: "swords",
  martial: "swords",
  hiit: "flame",
  crossfit: "flame",
};

function iconNameForSport(sport: string | null | undefined): string {
  if (!sport) return "activity";
  const key = sport.toLowerCase();
  if (SPORT_ICON[key]) return SPORT_ICON[key];
  for (const [k, v] of Object.entries(SPORT_ICON)) {
    if (key.includes(k)) return v;
  }
  return "activity";
}

function iconUrl(name: string): string {
  return `https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/${name}.svg`;
}

function formatStartTime(start: string | null): string {
  if (!start) return "—";
  try {
    return new Date(start).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatDuration(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDistance(m: number | null): string | null {
  if (m == null || !Number.isFinite(m) || m <= 0) return null;
  const km = m / 1000;
  if (km < 10) return `${km.toFixed(2)} km`;
  return `${km.toFixed(1)} km`;
}

type Props = {
  rows: TodayWorkoutRow[];
};

export default function TodayWorkouts({ rows }: Props) {
  if (rows.length === 0) return null;
  return (
    <div className="card">
      <div className="card-head">
        <div className="card-title">
          <span
            className="dot"
            style={{ background: STRAIN_COLOR, color: STRAIN_COLOR }}
          />
          Today&apos;s workouts
        </div>
        <span className="card-sub">
          {rows.length === 1 ? "1 session" : `${rows.length} sessions`}
        </span>
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {rows.map((w) => {
          const dotColor = sportColor(w.sport);
          const distance = formatDistance(w.distance_m);
          return (
            <li
              key={w.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.04)",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: `${dotColor}22`,
                  border: `1px solid ${dotColor}55`,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: "0 0 auto",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={iconUrl(iconNameForSport(w.sport))}
                  alt=""
                  style={{
                    width: 16,
                    height: 16,
                    filter: "invert(1)",
                    opacity: 0.85,
                  }}
                />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--fg-0)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {w.sport ?? "Unknown"}
                </div>
                <div
                  style={{
                    marginTop: 2,
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "var(--fg-3)",
                    letterSpacing: "0.02em",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <span>{formatStartTime(w.start_time)}</span>
                  <span style={{ opacity: 0.4 }}>·</span>
                  <span>{formatDuration(w.duration_sec)}</span>
                  {distance && (
                    <>
                      <span style={{ opacity: 0.4 }}>·</span>
                      <span>{distance}</span>
                    </>
                  )}
                  {w.avg_hr != null && (
                    <>
                      <span style={{ opacity: 0.4 }}>·</span>
                      <span>{w.avg_hr} bpm avg</span>
                    </>
                  )}
                </div>
              </div>
              <span
                style={{
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: `${STRAIN_COLOR}1a`,
                  border: `1px solid ${STRAIN_COLOR}44`,
                  color: STRAIN_COLOR,
                  fontFamily: "var(--font-display)",
                  fontSize: 13,
                  fontWeight: 600,
                  letterSpacing: "-0.01em",
                  fontVariantNumeric: "tabular-nums",
                  flex: "0 0 auto",
                }}
              >
                {w.strain != null ? w.strain.toFixed(1) : "—"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
