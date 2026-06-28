import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import {
  getWorkoutById,
  getWorkoutHrSeries,
  getWorkoutSource,
  getBodyMeasurements,
  getRecoveryTrend,
} from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import {
  parseHrSeries,
  recoveryRate,
  timeAbovePct,
  trimp,
  type HrSeries,
} from "@/lib/analytics/workoutMetrics";

export const dynamic = "force-dynamic";

// Whoop HR zones — palette shared by every HR visual (design-system constant).
// Zone boundaries follow Whoop's model: Z1 starts at 50% of max HR and each
// subsequent zone steps +10% (60/70/80/90%). Z0 is "rest" (below Z1).
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

// mm:ss from a seconds value (zone legend, time-above-threshold).
function clockFromSeconds(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

// h:mm elapsed label for the HR-curve x-axis.
function elapsedLabel(sec: number): string {
  const m = Math.round(sec / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${mm < 10 ? "0" : ""}${mm}`;
}

// Local clock range from the UTC timestamps, using the user's IANA tz when known
// (falls back to the server default). Returns null when there's no start time.
function formatTimeRange(
  startUtc: string | null,
  endUtc: string | null,
  tz: string | null | undefined,
): string | null {
  if (!startUtc) return null;
  const fmt = (iso: string): string | null => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    try {
      return new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: tz ?? undefined,
      }).format(d);
    } catch {
      return null;
    }
  };
  const s = fmt(startUtc);
  if (!s) return null;
  const e = endUtc ? fmt(endUtc) : null;
  return e ? `${s} – ${e}` : s;
}

/**
 * Intra-session cardiac drift: % change in mean HR from the first half of the
 * session to the second (the single-workout analogue of the cross-session
 * `cardiacDrift` module, which needs many same-sport workouts and can't speak
 * to one session). Positive = HR climbed for the same effort. `null` when there
 * isn't enough signal in either half.
 */
function intraSessionDrift(series: HrSeries): number | null {
  const { bpm, interval_sec, start_offset_sec } = series;
  const pts: { t: number; v: number }[] = [];
  for (let i = 0; i < bpm.length; i++) {
    const v = bpm[i];
    if (v == null) continue;
    pts.push({ t: start_offset_sec + i * interval_sec, v });
  }
  if (pts.length < 4) return null;
  const mid = (pts[0].t + pts[pts.length - 1].t) / 2;
  const first = pts.filter((p) => p.t < mid);
  const second = pts.filter((p) => p.t >= mid);
  if (first.length < 2 || second.length < 2) return null;
  const mean = (a: { v: number }[]) => a.reduce((s, p) => s + p.v, 0) / a.length;
  const m1 = mean(first);
  const m2 = mean(second);
  if (m1 <= 0) return null;
  return ((m2 - m1) / m1) * 100;
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
  // missing column and returns null. The page renders the full HR-curve +
  // derived-metrics layout when present, and a tasteful fallback otherwise.
  const rawSeries = getWorkoutHrSeries(user.id, id);
  const series = parseHrSeries(rawSeries);
  const hasSignal = !!series && series.bpm.some((b) => b != null);
  // Provenance: HealthKit-only rows (no Whoop parent) must not claim "Whoop".
  const isHealthKitOnly = getWorkoutSource(user.id, id) === "healthkit";

  // Profile max HR drives zone boundaries, the curve y-scale, time-above-90% and
  // TRIMP. Prefer the measured profile max, fall back to this workout's own peak.
  const body = getBodyMeasurements(user.id);
  const maxHr = body?.max_heart_rate ?? workout.max_hr ?? null;

  // 30-day resting HR for TRIMP's HRr term. null when there's no recovery signal
  // yet — trimp() returns null in that case, so the cell self-hides.
  const restingHr = (() => {
    const rows = getRecoveryTrend(user.id, 30);
    const vals = rows.map((r) => r.rhr).filter((v): v is number => v != null && v > 0);
    if (vals.length === 0) return null;
    return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  })();

  const totalZoneMs = ZONES.reduce((sum, z) => sum + (workout[z.key] ?? 0), 0);
  const zonesPresent = totalZoneMs > 0;
  const kcal = workout.kilojoule != null ? workout.kilojoule * 0.239 : null;
  const sessionSec =
    workout.duration_sec && workout.duration_sec > 0
      ? workout.duration_sec
      : series
        ? (series.bpm.length - 1) * series.interval_sec
        : null;

  const pctOfMax = (hr: number | null): number | null =>
    maxHr && hr != null ? Math.round((hr / maxHr) * 100) : null;

  const timeRange = formatTimeRange(
    workout.start_utc ?? null,
    workout.end_utc ?? null,
    user.timezone,
  );

  return (
    <>
      {/* back link + source badges */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Link href="/workouts" className="back-link">
          <svg
            viewBox="0 0 24 24"
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {isHealthKitOnly ? (
            <span className="source-badge healthkit">
              <span className="mark" />
              HealthKit
            </span>
          ) : (
            <span className="source-badge">
              <span className="mark" />
              Whoop
            </span>
          )}
          {hasSignal && !isHealthKitOnly ? (
            <span className="source-badge healthkit">
              <span className="mark" />
              HealthKit HR
            </span>
          ) : null}
        </div>
      </div>

      {/* title */}
      <div className="detail-head">
        <div className="h-left">
          <div className="detail-title">
            <span className="sport-ico">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ffaa00"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 12h3l2.5-7 4 14 2.5-9 1.5 2h4.5" />
              </svg>
            </span>
            <h1>{workout.sport ?? "Workout"}</h1>
          </div>
          <div className="detail-meta">
            {formatDate(workout.date)}
            {timeRange ? (
              <>
                <span className="sep">·</span>
                {timeRange}
              </>
            ) : null}
            <span className="sep">·</span>
            {formatDuration(workout.duration_sec)}
          </div>
        </div>
      </div>

      {/* hero stat strip */}
      <div className="stat-strip">
        <StatCell
          label="Strain"
          isStrain
          value={workout.strain != null ? workout.strain.toFixed(1) : "—"}
        />
        <StatCell
          label="Avg HR"
          value={
            workout.avg_hr != null ? (
              <>
                {workout.avg_hr}
                <span className="u">bpm</span>
              </>
            ) : (
              "—"
            )
          }
          sub={
            pctOfMax(workout.avg_hr) != null
              ? `${pctOfMax(workout.avg_hr)}% of max`
              : undefined
          }
        />
        <StatCell
          label="Max HR"
          value={
            workout.max_hr != null ? (
              <>
                {workout.max_hr}
                <span className="u">bpm</span>
              </>
            ) : (
              "—"
            )
          }
          sub={
            pctOfMax(workout.max_hr) != null
              ? `${pctOfMax(workout.max_hr)}% of max`
              : undefined
          }
        />
        <StatCell
          label="Energy"
          value={
            kcal != null ? (
              <>
                {Math.round(kcal).toLocaleString()}
                <span className="u">cal</span>
              </>
            ) : (
              "—"
            )
          }
          sub={
            workout.kilojoule != null
              ? `${Math.round(workout.kilojoule).toLocaleString()} kJ`
              : undefined
          }
        />
        <StatCell
          label="Distance"
          value={
            workout.distance_m != null && workout.distance_m > 0 ? (
              <>
                {(workout.distance_m / 1000).toFixed(2)}
                <span className="u">km</span>
              </>
            ) : (
              <span style={{ color: "var(--fg-4)" }}>—</span>
            )
          }
          sub={
            workout.distance_m != null && workout.distance_m > 0
              ? undefined
              : "not recorded"
          }
        />
      </div>

      <div className="grid-main">
        <div className="col">
          {hasSignal && series ? (
            <HrCurveCard
              series={series}
              maxHr={maxHr}
              avgHr={workout.avg_hr}
              peakHr={workout.max_hr}
            />
          ) : (
            <section className="card hr-chart">
              <div className="card-head">
                <div>
                  <div className="card-title">
                    <span
                      className="dot"
                      style={{ background: "#6b6b74", color: "#6b6b74" }}
                    />
                    Heart Rate
                  </div>
                  <div className="card-sub" style={{ marginTop: 4 }}>
                    per-second stream
                  </div>
                </div>
                <span className="card-sub" style={{ color: "var(--fg-2)" }}>
                  summary only
                </span>
              </div>
              <div className="nostream">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M3 12h3l2-5 4 10 2-6 1.5 1h5.5" />
                  <line x1="4" y1="4" x2="20" y2="20" strokeWidth="1.4" />
                </svg>
                <div className="t">HR detail not captured for this session</div>
                <div className="s">
                  This session was recorded by Whoop only. Per-second heart-rate
                  curves appear on sessions captured through Apple Health — newer
                  workouts, or once the historical backfill reaches this date.
                </div>
              </div>
            </section>
          )}

          <ZonesCard
            workout={workout}
            totalZoneMs={totalZoneMs}
            zonesPresent={zonesPresent}
            maxHr={maxHr}
          />
        </div>

        <div className="col">
          {hasSignal && series ? (
            <EffortRecoveryCard
              series={series}
              maxHr={maxHr}
              restingHr={restingHr}
              sessionSec={sessionSec}
            />
          ) : (
            <>
              <section className="card">
                <div className="card-head">
                  <div className="card-title">
                    <span
                      className="dot"
                      style={{ background: "#3f3f46", color: "#3f3f46" }}
                    />
                    Effort &amp; Recovery
                  </div>
                  <span className="card-sub">needs stream</span>
                </div>
                <div className="nostream" style={{ padding: "28px 22px" }}>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <rect x="5" y="11" width="14" height="9" rx="2" />
                    <path d="M8 11V8a4 4 0 018 0v3" />
                  </svg>
                  <div className="t">Effort metrics need the HR stream</div>
                  <div className="s">
                    Cardiac drift, recovery rate, time-above-threshold and TRIMP
                    are computed per-second. They populate automatically once a
                    HealthKit HR stream exists for this session.
                  </div>
                </div>
              </section>

              <SessionSummaryCard workout={workout} kcal={kcal} />
            </>
          )}

          {hasSignal ? <RouteCard /> : null}
        </div>
      </div>
    </>
  );
}

function StatCell({
  label,
  value,
  sub,
  isStrain,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  isStrain?: boolean;
}) {
  return (
    <div className={isStrain ? "stat-cell is-strain" : "stat-cell"}>
      <span className="lbl">{label}</span>
      <span className="val">{value}</span>
      {sub ? <span className="sub">{sub}</span> : null}
    </div>
  );
}

// ---- HR curve (inline zone-gradient area chart, rendered server-side) --------

function HrCurveCard({
  series,
  maxHr,
  avgHr,
  peakHr,
}: {
  series: HrSeries;
  maxHr: number | null;
  avgHr: number | null;
  peakHr: number | null;
}) {
  const { bpm, interval_sec, start_offset_sec } = series;
  const n = bpm.length;
  const sampleTime = (i: number) => start_offset_sec + i * interval_sec;

  // Non-null samples drive the geometry; null entries (sensor dropout) break the
  // line and are bridged in the area fill.
  const nn: { i: number; t: number; v: number }[] = [];
  for (let i = 0; i < n; i++) {
    const v = bpm[i];
    if (v != null) nn.push({ i, t: sampleTime(i), v });
  }

  const W = 760;
  const H = 240;
  const padL = 42;
  const padR = 14;
  const padT = 14;
  const padB = 24;

  const x0 = nn[0].t;
  const x1 = nn[nn.length - 1].t;
  const xSpan = Math.max(1, x1 - x0);
  const px = (t: number) => padL + ((t - x0) / xSpan) * (W - padL - padR);

  let seriesMax = -Infinity;
  let seriesMin = Infinity;
  let peakIdx = 0;
  nn.forEach((p, idx) => {
    if (p.v > seriesMax) {
      seriesMax = p.v;
      peakIdx = idx;
    }
    if (p.v < seriesMin) seriesMin = p.v;
  });

  const yTop = Math.ceil(Math.max(seriesMax, maxHr ?? seriesMax) / 10) * 10;
  const yBot = Math.max(0, Math.floor(seriesMin / 10) * 10 - 10);
  const ySpan = Math.max(1, yTop - yBot);
  const py = (v: number) => padT + ((yTop - v) / ySpan) * (H - padT - padB);

  // Line path — new sub-path after every gap.
  let linePath = "";
  let pendingMove = true;
  for (let i = 0; i < n; i++) {
    const v = bpm[i];
    if (v == null) {
      pendingMove = true;
      continue;
    }
    const X = px(sampleTime(i)).toFixed(1);
    const Y = py(v).toFixed(1);
    linePath += `${pendingMove ? "M" : " L"}${X},${Y}`;
    pendingMove = false;
  }

  // Area path — single polygon over all non-null points down to the baseline.
  const baseline = H - padB;
  const areaPts = nn
    .map((p, idx) => `${idx === 0 ? "M" : "L"}${px(p.t).toFixed(1)},${py(p.v).toFixed(1)}`)
    .join(" ");
  const areaPath = `${areaPts} L${px(x1).toFixed(1)},${baseline} L${px(x0).toFixed(1)},${baseline} Z`;

  // Zone boundaries (60/70/80/90% of max HR) drive the gradient + gridlines.
  const b = (frac: number) => (maxHr != null ? Math.round(maxHr * frac) : null);
  const b60 = b(0.6);
  const b70 = b(0.7);
  const b80 = b(0.8);
  const b90 = b(0.9);
  const gradOffset = (v: number) =>
    Math.max(0, Math.min(100, ((yTop - v) / ySpan) * 100)).toFixed(1);

  const hasZones = b60 != null && b70 != null && b80 != null && b90 != null;
  const gradientStops = hasZones
    ? [
        { o: "0", c: "#b91c1c" },
        { o: `${gradOffset(b90!)}%`, c: "#b91c1c" },
        { o: `${gradOffset(b90!)}%`, c: "#f97316" },
        { o: `${gradOffset(b80!)}%`, c: "#f97316" },
        { o: `${gradOffset(b80!)}%`, c: "#facc15" },
        { o: `${gradOffset(b70!)}%`, c: "#facc15" },
        { o: `${gradOffset(b70!)}%`, c: "#06b6d4" },
        { o: `${gradOffset(b60!)}%`, c: "#06b6d4" },
        { o: `${gradOffset(b60!)}%`, c: "#2563eb" },
        { o: "100%", c: "#2563eb" },
      ]
    : [];

  const boundaries = hasZones ? [b60!, b70!, b80!, b90!] : [];
  const gridLines = boundaries.filter((v) => v > yBot && v < yTop);

  // Four y-axis labels evenly spaced across the visible range, rounded to 5.
  const yLabels = [0, 1, 2, 3].map((k) =>
    Math.round((yBot + (ySpan * k) / 3) / 5) * 5,
  );

  // Five elapsed x-axis ticks.
  const xTicks = [0, 1, 2, 3, 4].map((k) => x0 + (xSpan * k) / 4);

  const peak = nn[peakIdx];
  const peakLabel = Math.round(peak.v);

  const zoneLegend = [
    { label: "Z1", color: "#2563eb", range: b60 != null ? `<${b60}` : null },
    {
      label: "Z2",
      color: "#06b6d4",
      range: b60 != null && b70 != null ? `${b60}–${b70}` : null,
    },
    {
      label: "Z3",
      color: "#facc15",
      range: b70 != null && b80 != null ? `${b70}–${b80}` : null,
    },
    {
      label: "Z4",
      color: "#f97316",
      range: b80 != null && b90 != null ? `${b80}–${b90}` : null,
    },
    { label: "Z5", color: "#b91c1c", range: b90 != null ? `≥${b90}` : null },
  ];

  return (
    <section className="card hr-chart">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#f97316", color: "#f97316" }} />
            Heart Rate
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            HealthKit · {nn.length.toLocaleString()} samples
          </div>
        </div>
        <div className="peakavg">
          {peakHr != null ? (
            <span className="pa">
              peak <b>{peakHr}</b>
            </span>
          ) : null}
          {avgHr != null ? (
            <span className="pa">
              avg <b>{avgHr}</b>
            </span>
          ) : null}
        </div>
      </div>

      <div className="hr-svg-wrap">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height: "auto", aspectRatio: `${W} / ${H}` }}
        >
          <defs>
            <linearGradient id="hrZone" x1="0" y1="0" x2="0" y2="1">
              {gradientStops.map((s, idx) => (
                <stop key={idx} offset={s.o} stopColor={s.c} />
              ))}
            </linearGradient>
            <linearGradient id="hrFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f97316" stopOpacity="0.5" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0.05" />
            </linearGradient>
          </defs>

          {gridLines.map((v) => (
            <line
              key={v}
              x1={padL}
              y1={py(v).toFixed(1)}
              x2={W - padR}
              y2={py(v).toFixed(1)}
              stroke="rgba(255,255,255,0.05)"
              strokeDasharray="3 4"
            />
          ))}

          <path
            d={areaPath}
            fill={hasZones ? "url(#hrZone)" : "url(#hrFade)"}
            opacity={hasZones ? 0.42 : 0.6}
          />
          <path
            d={linePath}
            fill="none"
            stroke="rgba(255,255,255,0.92)"
            strokeWidth="1.6"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {yLabels.map((v) => (
            <text
              key={v}
              x={padL - 7}
              y={(py(v) + 3).toFixed(1)}
              textAnchor="end"
              fill="#3f3f46"
              fontFamily="var(--font-mono)"
              fontSize="9"
            >
              {v}
            </text>
          ))}

          {/* peak marker */}
          <circle cx={px(peak.t).toFixed(1)} cy={py(peak.v).toFixed(1)} r="3.5" fill="#fff" />
          <circle
            cx={px(peak.t).toFixed(1)}
            cy={py(peak.v).toFixed(1)}
            r="6.5"
            fill="none"
            stroke="rgba(255,255,255,0.4)"
          />
          <text
            x={px(peak.t).toFixed(1)}
            y={(py(peak.v) - 12).toFixed(1)}
            textAnchor="middle"
            fill="#fff"
            fontFamily="var(--font-mono)"
            fontSize="10"
            fontWeight="600"
          >
            {peakLabel}
          </text>
        </svg>
      </div>

      <div className="hr-axis-x">
        {xTicks.map((t, idx) => (
          <span key={idx}>{elapsedLabel(t - x0)}</span>
        ))}
      </div>

      <div className="hr-legend" style={{ marginTop: 12 }}>
        {zoneLegend.map((z) => (
          <span className="z" key={z.label}>
            <i style={{ background: z.color }} />
            {z.label}
            {z.range ? ` ${z.range}` : ""}
          </span>
        ))}
      </div>
    </section>
  );
}

// ---- HR zones (Whoop zone_*_ms breakdown) -----------------------------------

function ZonesCard({
  workout,
  totalZoneMs,
  zonesPresent,
  maxHr,
}: {
  workout: NonNullable<ReturnType<typeof getWorkoutById>>;
  totalZoneMs: number;
  zonesPresent: boolean;
  maxHr: number | null;
}) {
  const b = (frac: number) => (maxHr != null ? Math.round(maxHr * frac) : null);
  const b50 = b(0.5);
  const b60 = b(0.6);
  const b70 = b(0.7);
  const b80 = b(0.8);
  const b90 = b(0.9);
  const ranges: Record<string, string | null> = {
    Z0: "rest",
    Z1: b50 != null && b60 != null ? `${b50}–${b60}` : null,
    Z2: b60 != null && b70 != null ? `${b60}–${b70}` : null,
    Z3: b70 != null && b80 != null ? `${b70}–${b80}` : null,
    Z4: b80 != null && b90 != null ? `${b80}–${b90}` : null,
    Z5: b90 != null ? `≥${b90}` : null,
  };

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          <span className="dot" style={{ background: "#06b6d4", color: "#06b6d4" }} />
          HR Zones
        </div>
        <span className="card-sub">
          {maxHr != null ? `max HR ${maxHr} bpm · ` : ""}
          from Whoop · {formatDuration(workout.duration_sec)} total
        </span>
      </div>

      {zonesPresent ? (
        <>
          <div className="zone-bar">
            {ZONES.map((z) => {
              const ms = workout[z.key] ?? 0;
              const pct = (ms / totalZoneMs) * 100;
              if (pct <= 0) return null;
              return (
                <span
                  key={z.label}
                  title={`${z.label}: ${clockFromSeconds(ms / 1000)}`}
                  style={{ width: `${pct}%`, background: z.color }}
                />
              );
            })}
          </div>
          <div className="zone-legend">
            {ZONES.map((z) => {
              const ms = workout[z.key] ?? 0;
              const pct = (ms / totalZoneMs) * 100;
              return (
                <div className="zc" key={z.label}>
                  <span className="top">
                    <i style={{ background: z.color }} />
                    {z.label}
                  </span>
                  <span className="min">{clockFromSeconds(ms / 1000)}</span>
                  <span className="pct">{Math.round(pct)}%</span>
                  {ranges[z.label] ? (
                    <span className="zone-range">{ranges[z.label]}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--fg-3)",
          }}
        >
          No HR zone data for this workout
        </div>
      )}
    </section>
  );
}

// ---- Effort & Recovery (derived from the HR stream, marked "Estimated") -----

function EffortRecoveryCard({
  series,
  maxHr,
  restingHr,
  sessionSec,
}: {
  series: HrSeries;
  maxHr: number | null;
  restingHr: number | null;
  sessionSec: number | null;
}) {
  const drift = intraSessionDrift(series);
  const rr = recoveryRate(series);
  const t90 = timeAbovePct(series, maxHr, 0.9);
  const tr =
    maxHr != null && restingHr != null
      ? trimp(series, { rest: restingHr, max: maxHr })
      : null;

  const cells: ReactNode[] = [];

  if (drift != null) {
    const up = drift > 0;
    cells.push(
      <div className="derived-cell" key="drift">
        <span className="lbl">Cardiac drift</span>
        <span className="val" style={{ color: up ? "#ffaa00" : "#00d4aa" }}>
          {up ? "+" : ""}
          {drift.toFixed(1)}
          <span style={{ fontSize: 15, color: "var(--fg-3)" }}>%</span>
        </span>
        <span className="hint">HR ÷ effort, 1st vs 2nd half</span>
      </div>,
    );
  }

  if (rr != null) {
    const good = rr <= 0;
    cells.push(
      <div className="derived-cell" key="rr">
        <span className="lbl">Recovery rate</span>
        <span className="val" style={{ color: good ? "#00d4aa" : "#ffaa00" }}>
          {rr > 0 ? "+" : rr < 0 ? "−" : ""}
          {Math.abs(Math.round(rr))}
          <span style={{ fontSize: 13, color: "var(--fg-3)" }}> bpm/min</span>
        </span>
        <span className="hint">drop in first minute post-peak</span>
      </div>,
    );
  }

  if (t90 != null && maxHr != null) {
    const pct =
      sessionSec && sessionSec > 0 ? Math.round((t90 / sessionSec) * 100) : null;
    cells.push(
      <div className="derived-cell" key="t90">
        <span className="lbl">Time &gt; 90% max</span>
        <span className="val">{clockFromSeconds(t90)}</span>
        <span className="hint">
          {pct != null ? `${pct}% of session ` : ""}above {Math.round(maxHr * 0.9)} bpm
        </span>
      </div>,
    );
  }

  if (tr != null) {
    cells.push(
      <div className="derived-cell" key="trimp">
        <span className="lbl">TRIMP</span>
        <span className="val">{Math.round(tr)}</span>
        <span className="hint">Banister training impulse</span>
      </div>,
    );
  }

  if (cells.length === 0) {
    // Stream exists but nothing computable (e.g. no maxHr/resting baseline).
    return (
      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
            Effort &amp; Recovery
          </div>
          <span className="card-sub">needs profile baseline</span>
        </div>
        <div className="nostream" style={{ padding: "28px 22px" }}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4" />
          </svg>
          <div className="t">Effort metrics need a profile baseline</div>
          <div className="s">
            These estimates need a max and resting HR from your 30-day profile.
            They populate once that baseline exists.
          </div>
        </div>
      </section>
    );
  }

  const noteMax = maxHr != null ? `${maxHr} bpm max` : "your profile max";
  const noteRest = restingHr != null ? `${restingHr} bpm resting HR` : "resting HR";

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
          Effort &amp; Recovery
        </div>
        <span className="est-tag">
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "currentColor",
            }}
          />
          Estimated
        </span>
      </div>
      <div className="derived-grid">{cells}</div>
      <p
        style={{
          margin: "14px 0 0",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--fg-3)",
          lineHeight: 1.5,
        }}
      >
        Derived server-side from the HealthKit HR stream. Estimates assume a{" "}
        {noteMax} and {noteRest} from your 30-day profile.
      </p>
    </section>
  );
}

// ---- Route & Pace (GPS placeholder until Apple Watch workouts land) ----------

function RouteCard() {
  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
          Route &amp; Pace
        </div>
        <span className="card-sub">GPS</span>
      </div>
      <div className="nostream">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 21s-7-6.3-7-11a7 7 0 0114 0c0 4.7-7 11-7 11z" />
          <circle cx="12" cy="10" r="2.4" />
        </svg>
        <div className="t">No GPS for this session</div>
        <div className="s">
          This session has no location track. Map, pace and elevation appear
          automatically for Apple Watch–recorded runs and rides.
        </div>
      </div>
    </section>
  );
}

// ---- Whoop session summary (right column, no-stream variant) -----------------

function SessionSummaryCard({
  workout,
  kcal,
}: {
  workout: NonNullable<ReturnType<typeof getWorkoutById>>;
  kcal: number | null;
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Duration", value: formatDuration(workout.duration_sec) },
    {
      label: "Strain",
      value: workout.strain != null ? workout.strain.toFixed(1) : "—",
    },
    {
      label: "Energy",
      value:
        kcal != null
          ? `${Math.round(kcal).toLocaleString()} cal · ${Math.round(
              workout.kilojoule ?? 0,
            ).toLocaleString()} kJ`
          : "—",
    },
    {
      label: "Avg · Max HR",
      value:
        workout.avg_hr != null || workout.max_hr != null
          ? `${workout.avg_hr ?? "—"} · ${workout.max_hr ?? "—"} bpm`
          : "—",
    },
  ];

  return (
    <section className="card">
      <div className="card-head">
        <div className="card-title">
          <span className="dot" style={{ background: "#ffaa00", color: "#ffaa00" }} />
          Session summary
        </div>
        <span className="card-sub">Whoop</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((r, idx) => (
          <div
            key={r.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "9px 0",
              borderBottom:
                idx < rows.length - 1
                  ? "1px solid rgba(255,255,255,0.05)"
                  : undefined,
            }}
          >
            <span className="microlabel" style={{ fontSize: 10 }}>
              {r.label}
            </span>
            <span
              className="tnum"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                color:
                  r.label === "Strain" ? "var(--metric-strain)" : "var(--fg-1)",
              }}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
