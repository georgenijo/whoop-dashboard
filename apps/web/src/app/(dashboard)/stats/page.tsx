import { headers } from "next/headers";
import Link from "next/link";
import { requireAuthOrSignin } from "@/lib/auth";
import {
  getAllTimeStats,
  getYearComparison,
  getSportBreakdown,
  getPersonalRecords,
  getMonthlyRollup,
  type YoyMetric,
  type MonthlyRollupRow,
} from "@/lib/db";
import { localToday } from "@/lib/date";
import { shiftDate } from "@/lib/range";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Range pills — extend the existing `?range=` pattern with stats-specific
// windows. The pills scope range-based visualizations; lifetime totals,
// same-period YoY comparison, and personal records retain their explicit
// intrinsic scopes. Default is the current year.
// ---------------------------------------------------------------------------
type StatsRange = "30d" | "90d" | "ytd" | "year" | "all";
const RANGE_KEYS: StatsRange[] = ["30d", "90d", "ytd", "year", "all"];

const METERS_PER_MILE = 1609.344;
const KJ_PER_KCAL = 4.184;
const SPORT_COLORS = [
  "#00aaff",
  "#7b61ff",
  "#ffaa00",
  "#00d4aa",
  "#ff6b6b",
  "#22c55e",
  "#06b6d4",
  "#facc15",
  "#3f3f46",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function fmtHM(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${pad2(m)}`;
}

function resolveRange(
  raw: string | undefined,
  year: number,
  today: string,
): { range: StatsRange; start: string; end: string; label: string } {
  const range: StatsRange = RANGE_KEYS.includes(raw as StatsRange)
    ? (raw as StatsRange)
    : "year";
  switch (range) {
    case "30d":
      return { range, start: shiftDate(today, -29), end: today, label: "Last 30 days" };
    case "90d":
      return { range, start: shiftDate(today, -89), end: today, label: "Last 90 days" };
    case "ytd":
      return { range, start: `${year}-01-01`, end: today, label: "Year to date" };
    case "all":
      return { range, start: "1970-01-01", end: today, label: "All-time" };
    case "year":
    default:
      return { range, start: `${year}-01-01`, end: today, label: String(year) };
  }
}

// ---------------------------------------------------------------------------
// Inline SVG helpers (server-rendered — no client JS).
// ---------------------------------------------------------------------------
function Spark({ vals, color }: { vals: number[]; color: string }) {
  const w = 64;
  const h = 22;
  if (vals.length < 2) return null;
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const rng = mx - mn || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * w;
    const y = h - 2 - ((v - mn) / rng) * (h - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const [lx, ly] = pts[pts.length - 1].split(",");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lx} cy={ly} r={1.8} fill={color} />
    </svg>
  );
}

const ArrowUp = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);
const ArrowDown = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
);
const Trophy = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 4h12v3a6 6 0 01-12 0z" />
    <path d="M6 5H3v1a3 3 0 003 3M18 5h3v1a3 3 0 01-3 3" />
    <path d="M9 14.5h6M10 20h4M12 14.5V20" />
  </svg>
);

// A single YoY comparison row. `kind` selects unit conversion + formatting.
type StatcKind = "count" | "distance" | "hours" | "calories";

function buildStatc(
  label: string,
  kind: StatcKind,
  m: YoyMetric,
  priorYear: number,
) {
  const conv = (v: number): number => {
    if (kind === "distance") return v / METERS_PER_MILE;
    if (kind === "calories") return v / KJ_PER_KCAL / 1000;
    return v; // count, hours already converted upstream
  };
  const unit = kind === "distance" ? "mi" : kind === "hours" ? "h" : kind === "calories" ? "k" : "";

  if (m.current == null) {
    return { label, cur: "—", unit: "", prior: `vs ${priorYear} · —`, delta: null, spark: [] as number[] };
  }
  const cur = conv(m.current);
  const priorStr =
    m.prior != null ? `vs ${priorYear} · ${fmtInt(conv(m.prior))}${unit ? ` ${unit}` : ""}` : `vs ${priorYear} · —`;

  let delta: { str: string; dir: "up" | "down" } | null = null;
  if (m.delta != null) {
    const d = conv(m.delta);
    const up = d >= 0;
    const sign = up ? "+" : "−";
    delta = { str: `${sign}${fmtInt(Math.abs(d))}${unit ? ` ${unit}` : ""}`, dir: up ? "up" : "down" };
  }
  return {
    label,
    cur: fmtInt(cur),
    unit,
    prior: priorStr,
    delta,
    spark: m.spark.map(conv),
  };
}

function TrendChart({ months }: { months: MonthlyRollupRow[] }) {
  const W = 760;
  const H = 240;
  const padL = 34;
  const padR = 34;
  const padT = 16;
  const padB = 30;
  const n = months.length;
  if (n === 0) return null;
  const slot = (W - padL - padR) / n;
  const bw = slot * 0.56;
  const mxC = Math.max(...months.map((d) => d.count), 1);

  const strains = months.map((d) => d.avgStrain).filter((s): s is number => s != null);
  const hasStrain = strains.length > 0;
  let mnS = hasStrain ? Math.floor(Math.min(...strains)) : 0;
  let mxS = hasStrain ? Math.ceil(Math.max(...strains)) : 1;
  if (mnS === mxS) {
    mnS -= 1;
    mxS += 1;
  }

  const bx = (i: number) => padL + slot * i + slot * 0.22;
  const byTop = (c: number) => padT + (1 - c / mxC) * (H - padT - padB);
  const syY = (s: number) => padT + (1 - (s - mnS) / (mxS - mnS)) * (H - padT - padB);

  const linePts = months
    .map((d, i) => (d.avgStrain != null ? `${(bx(i) + bw / 2).toFixed(1)},${syY(d.avgStrain).toFixed(1)}` : null))
    .filter((p): p is string => p != null);

  const monthLabel = (ym: string) =>
    new Date(ym + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" });

  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: "auto", aspectRatio: `${W} / ${H}` }}
      >
        <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="rgba(255,255,255,0.08)" />
        {months.map((d, i) => {
          const top = byTop(d.count);
          const barH = H - padB - top;
          return (
            <g key={d.month}>
              <rect
                x={bx(i)}
                y={top}
                width={bw}
                height={Math.max(0, barH)}
                rx={3}
                fill="#2563eb"
                opacity={d.partial ? 0.42 : 0.85}
              />
              <text
                x={bx(i) + bw / 2}
                y={top - 6}
                textAnchor="middle"
                fill="#a1a1aa"
                fontFamily="Geist Mono"
                fontSize={10}
                fontWeight={600}
              >
                {d.count}
              </text>
            </g>
          );
        })}
        {hasStrain && linePts.length > 1 && (
          <polyline
            points={linePts.join(" ")}
            fill="none"
            stroke="#ffaa00"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {hasStrain &&
          months.map((d, i) =>
            d.avgStrain != null ? (
              <circle key={`pt-${d.month}`} cx={bx(i) + bw / 2} cy={syY(d.avgStrain)} r={3} fill="#ffaa00" />
            ) : null,
          )}
        {months.map((d, i) => (
          <text
            key={`x-${d.month}`}
            x={bx(i) + bw / 2}
            y={H - padB + 18}
            textAnchor="middle"
            fill="#6b6b74"
            fontFamily="Geist Mono"
            fontSize={10}
          >
            {monthLabel(d.month)}
            {d.partial ? "*" : ""}
          </text>
        ))}
      </svg>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 9.5,
          color: "var(--fg-4)",
          marginTop: 4,
          textAlign: "right",
        }}
      >
        * partial month
      </div>
    </>
  );
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );
  const { range: rawRange } = await searchParams;

  const today = localToday();
  const year = new Date().getFullYear();
  const sel = resolveRange(rawRange, year, today);

  const allTime = getAllTimeStats(user.id);

  if (allTime.workouts === 0) {
    return (
      <div className="card">
        <div className="empty-state">
          <div className="title">No workouts logged yet</div>
          <div className="sub">All-time totals, year-over-year trends, and records appear once you have workout history.</div>
        </div>
      </div>
    );
  }

  const yoy = getYearComparison(user.id, year);
  const sports = getSportBreakdown(user.id, sel.start, sel.end);
  const records = getPersonalRecords(user.id);
  const months = getMonthlyRollup(user.id, sel.start, sel.end);

  // ---- Range pills (server-friendly Links) ----
  const pillLabel = (k: StatsRange): string =>
    k === "ytd" ? "YTD" : k === "year" ? String(year) : k === "all" ? "All" : k.toUpperCase();

  // ---- All-time totals ----
  const totals = [
    { lbl: "Workouts", val: fmtInt(allTime.workouts), u: "" },
    {
      lbl: "Active time",
      val: allTime.activeSeconds != null ? fmtInt(allTime.activeSeconds / 3600) : "—",
      u: allTime.activeSeconds != null ? "h" : "",
    },
    {
      lbl: "Distance",
      val: allTime.distanceMeters != null ? fmtInt(allTime.distanceMeters / METERS_PER_MILE) : "—",
      u: allTime.distanceMeters != null ? "mi" : "",
    },
    {
      lbl: "Energy",
      val: allTime.kilojoules != null ? fmtInt(allTime.kilojoules / KJ_PER_KCAL / 1000) : "—",
      u: allTime.kilojoules != null ? "k cal" : "",
    },
  ];

  // ---- YoY statc rows ----
  const statcs = [
    buildStatc("Workouts", "count", yoy.workouts, yoy.priorYear),
    buildStatc("Distance", "distance", yoy.distanceMeters, yoy.priorYear),
    buildStatc("Active hrs", "hours", yoy.activeHours, yoy.priorYear),
    buildStatc("Calories", "calories", yoy.calories, yoy.priorYear),
  ];

  // ---- By sport ----
  const sportTotal = sports.reduce((a, s) => a + s.count, 0);
  const sportMax = Math.max(...sports.map((s) => s.count), 1);

  // ---- Personal records ----
  const recordCards = [
    {
      lbl: "Longest session",
      val: records.longestSessionSec.value != null ? fmtHM(records.longestSessionSec.value) : "—",
      u: "",
      meta: records.longestSessionSec.meta,
    },
    {
      lbl: "Most calories",
      val: records.mostKilojoules.value != null ? fmtInt(records.mostKilojoules.value / KJ_PER_KCAL) : "—",
      u: records.mostKilojoules.value != null ? "cal" : "",
      meta: records.mostKilojoules.meta,
    },
    {
      lbl: "Highest strain",
      val: records.highestStrain.value != null ? records.highestStrain.value.toFixed(1) : "—",
      u: "",
      meta: records.highestStrain.meta,
    },
    {
      lbl: "Biggest week",
      val: records.biggestWeekSec.value != null ? fmtHM(records.biggestWeekSec.value) : "—",
      u: records.biggestWeekSec.value != null ? "h" : "",
      meta: records.biggestWeekSec.meta,
    },
    {
      lbl: "Top HR",
      val: records.topHr.value != null ? fmtInt(records.topHr.value) : "—",
      u: records.topHr.value != null ? "bpm" : "",
      meta: records.topHr.meta,
    },
    {
      lbl: "Most sessions / mo",
      val: records.mostSessionsMonth.value != null ? fmtInt(records.mostSessionsMonth.value) : "—",
      u: "",
      meta: records.mostSessionsMonth.meta,
    },
  ];

  // ---- Trend window label ----
  const trendLabel =
    months.length > 0
      ? `${new Date(months[0].month + "-01T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })} – ${new Date(
          months[months.length - 1].month + "-01T00:00:00",
        ).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
      : "";

  return (
    <>
      {/* range pills */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
        <div className="range" role="tablist" aria-label="Time range">
          {RANGE_KEYS.map((k) => (
            <Link
              key={k}
              href={`?range=${k}`}
              role="tab"
              aria-selected={sel.range === k}
              className={sel.range === k ? "active" : ""}
            >
              {pillLabel(k)}
            </Link>
          ))}
        </div>
      </div>

      {/* ALL-TIME */}
      <section>
        <div className="stats-microlabel">All-time</div>
        <div className="totals-strip">
          {totals.map((t) => (
            <div className="total-cell" key={t.lbl}>
              <span className="lbl">{t.lbl}</span>
              <span className="val tnum">
                {t.val}
                {t.u && <span className="u">{t.u}</span>}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* YoY */}
      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
              {yoy.year} vs {yoy.priorYear}
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              same-period year over year · {yoy.periodLabel}
            </div>
          </div>
        </div>
        <div className="statc-grid">
          {statcs.map((s) => (
            <div className="statc" key={s.label}>
              <div className="sc-left">
                <div className="sc-lbl">{s.label}</div>
                <div className="sc-cur tnum">
                  {s.cur}
                  {s.unit && <span className="u">{s.unit}</span>}
                </div>
                <div className="sc-prior">{s.prior}</div>
              </div>
              <div className="sc-right">
                {s.delta && (
                  <span className={`sc-delta ${s.delta.dir}`}>
                    {s.delta.dir === "up" ? ArrowUp : ArrowDown}
                    {s.delta.str}
                  </span>
                )}
                <span className="sc-spark">
                  <Spark vals={s.spark} color={s.delta?.dir === "down" ? "#ff6b6b" : "#00d4aa"} />
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="backfill-note" style={{ marginTop: 14 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v5M12 16h.01" />
          </svg>
          {yoy.priorYear} baseline is partial — full sync reaches back to Dec 5, 2025. Earlier months are
          incomplete, so year-over-year deltas understate prior-year totals until the historical backfill
          completes.
        </div>
      </section>

      {/* BY SPORT */}
      <section className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#ffaa00", color: "#ffaa00" }} />
            By sport
          </div>
          <span className="card-sub">
            {sel.label} · {sportTotal} {sportTotal === 1 ? "session" : "sessions"}
          </span>
        </div>
        {sports.length === 0 ? (
          <div className="empty-state">
            <div className="sub">No workouts in this range.</div>
          </div>
        ) : (
          <div className="sport-list">
            {sports.map((s, i) => {
              const color = SPORT_COLORS[i % SPORT_COLORS.length];
              return (
                <div className="sport-row" key={s.sport}>
                  <span className="name">
                    <i style={{ background: color }} />
                    {s.sport}
                  </span>
                  <span className="track">
                    <span style={{ width: `${(s.count / sportMax) * 100}%`, background: color }} />
                  </span>
                  <span className="n">{s.count}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* PERSONAL RECORDS */}
      <section>
        <div className="stats-microlabel">Personal records</div>
        <div className="record-grid">
          {recordCards.map((r) => (
            <div className="record-card" key={r.lbl}>
              <div className="rc-ico">{Trophy}</div>
              <div className="rc-lbl">{r.lbl}</div>
              <div className="rc-val tnum">
                {r.val}
                {r.u && <span className="u">{r.u}</span>}
              </div>
              <div className="rc-meta">{r.meta ?? "No data yet"}</div>
            </div>
          ))}
        </div>
      </section>

      {/* YoY TREND */}
      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: "#2563eb", color: "#2563eb" }} />
              Activity trend
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              {sel.label} · monthly rollup · {trendLabel}
            </div>
          </div>
          <div className="trend-legend">
            <span className="tl">
              <i style={{ background: "#2563eb" }} />
              Workouts
            </span>
            <span className="tl">
              <i style={{ background: "#ffaa00" }} />
              Avg strain
            </span>
          </div>
        </div>
        <div className="trend-svg-wrap">
          <TrendChart months={months} />
        </div>
      </section>
    </>
  );
}
