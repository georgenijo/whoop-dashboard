import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getWorkoutById, getWorkoutHrSeries } from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ZONES = [
  { key: "zone_0_ms" as const, label: "Z0", color: "#1e3a8a" },
  { key: "zone_1_ms" as const, label: "Z1", color: "#2563eb" },
  { key: "zone_2_ms" as const, label: "Z2", color: "#06b6d4" },
  { key: "zone_3_ms" as const, label: "Z3", color: "#facc15" },
  { key: "zone_4_ms" as const, label: "Z4", color: "#f97316" },
  { key: "zone_5_ms" as const, label: "Z5", color: "#b91c1c" },
];

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMinutes(ms: number | null): string {
  if (ms == null || ms <= 0) return "0m";
  const min = ms / 60_000;
  if (min < 1) return `${Math.round(ms / 1000)}s`;
  return `${min.toFixed(min >= 10 ? 0 : 1)}m`;
}

export default async function WorkoutDetailPage({
  params,
}: {
  // Next.js 16.2.4: dynamic route params are async (a Promise) — await before use.
  params: Promise<{ id: string }>;
}) {
  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const { id } = await params;

  const workout = getWorkoutById(user.id, id);
  if (!workout) {
    // Unknown id, or a workout owned by another user — both 404 (getWorkoutById
    // is tenant-scoped, so cross-user ids resolve to undefined).
    notFound();
  }

  // hr_series is added by the HealthKit ingest migration (T1); read tolerates a
  // missing column and returns null. T4 renders the HR curve when present.
  const hrSeries = getWorkoutHrSeries(user.id, id);

  const totalZoneMs = ZONES.reduce((sum, z) => sum + (workout[z.key] ?? 0), 0);
  const zonesPresent = totalZoneMs > 0;
  const kcal = workout.kilojoule != null ? workout.kilojoule * 0.239 : null;

  return (
    <>
      {/* back link + (T4) source badges */}
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/workouts"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--fg-3)",
            textDecoration: "none",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        >
          <svg
            viewBox="0 0 24 24"
            style={{ width: 14, height: 14 }}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Workouts
        </Link>
      </div>

      {/* title */}
      <div style={{ marginBottom: 20 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 24,
            fontWeight: 600,
            color: "var(--fg-0)",
          }}
        >
          {workout.sport ?? "Workout"}
        </h1>
        <div
          style={{
            marginTop: 4,
            color: "var(--fg-3)",
            fontFamily: "var(--font-mono)",
            fontSize: 13,
          }}
        >
          {formatDate(workout.date)}
          <span style={{ margin: "0 8px", color: "var(--fg-4)" }}>·</span>
          {formatDuration(workout.duration_sec)}
        </div>
      </div>

      {/* hero summary — Whoop metrics */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 16,
          }}
        >
          <Stat label="Strain" value={workout.strain?.toFixed(1) ?? "—"} accent="#ffaa00" />
          <Stat label="Avg HR" value={workout.avg_hr != null ? `${workout.avg_hr} bpm` : "—"} />
          <Stat label="Max HR" value={workout.max_hr != null ? `${workout.max_hr} bpm` : "—"} />
          <Stat
            label="Energy"
            value={kcal != null ? `${kcal.toFixed(0)} cal` : "—"}
            sub={workout.kilojoule != null ? `${workout.kilojoule.toFixed(0)} kJ` : undefined}
          />
          <Stat
            label="Distance"
            value={
              workout.distance_m != null && workout.distance_m > 0
                ? `${(workout.distance_m / 1000).toFixed(2)} km`
                : "—"
            }
          />
        </div>
      </div>

      {/*
        TODO(T4): flesh out this shell —
          - HR curve (zone-gradient SVG area + peak marker) when `hrSeries` is present
            (workout-detail.html); fall back to summary + zones only otherwise
            (workout-detail-no-stream.html).
          - Source badges (Whoop / HealthKit HR) in the header row above.
          - Effort & Recovery derived grid (cardiac drift, recovery rate, time>90%, TRIMP).
          - Route & Pace card (GPS placeholder until Apple Watch workouts land).
        `hrSeries` is wired through already (null until the T1 migration lands).
      */}

      {/* HR zones — reused at-a-glance breakdown */}
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#06b6d4", color: "#06b6d4" }} />
            HR Zones
          </div>
          <span className="card-sub">
            {hrSeries ? "HR stream available" : `${formatDuration(workout.duration_sec)} total`}
          </span>
        </div>

        {zonesPresent ? (
          <>
            <div
              style={{
                display: "flex",
                width: "100%",
                height: 10,
                borderRadius: 5,
                overflow: "hidden",
                margin: "4px 0 12px",
                background: "rgba(255,255,255,0.04)",
              }}
            >
              {ZONES.map((z) => {
                const ms = workout[z.key] ?? 0;
                const pct = totalZoneMs > 0 ? (ms / totalZoneMs) * 100 : 0;
                if (pct <= 0) return null;
                return (
                  <span
                    key={z.label}
                    title={`${z.label}: ${formatMinutes(ms)}`}
                    style={{ width: `${pct}%`, background: z.color }}
                  />
                );
              })}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, 1fr)",
                gap: 8,
              }}
            >
              {ZONES.map((z) => {
                const ms = workout[z.key] ?? 0;
                const pct = totalZoneMs > 0 ? (ms / totalZoneMs) * 100 : 0;
                return (
                  <div key={z.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 9,
                        color: "var(--fg-3)",
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: 1, background: z.color }} />
                      {z.label}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 11,
                        color: "var(--fg-1)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {formatMinutes(ms)}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--fg-3)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {pct.toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-3)" }}>
            No HR zone data for this workout
          </div>
        )}
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--fg-3)",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: accent ?? "var(--fg-0)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
      {sub ? (
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--fg-3)",
          }}
        >
          {sub}
        </span>
      ) : null}
    </div>
  );
}
