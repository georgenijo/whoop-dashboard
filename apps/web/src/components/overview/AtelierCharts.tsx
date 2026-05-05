import { smoothPath, sparklinePoints } from "@/lib/paths";
import type { RecoveryRow, SleepRow } from "@/lib/db";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtMs(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return "0h 00m";
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function dateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function pickAxisLabels(rows: RecoveryRow[]): string[] {
  if (rows.length === 0) return [];
  const idx = [
    0,
    Math.floor(rows.length / 4),
    Math.floor(rows.length / 2),
    Math.floor((rows.length * 3) / 4),
    rows.length - 1,
  ];
  return Array.from(new Set(idx)).map((i) => dateLabel(rows[i].date));
}

// ─── Recovery line chart ─────────────────────────────────────────────────────

function RecoveryChart({ rows }: { rows: RecoveryRow[] }) {
  const values = rows
    .map((r) => r.recovery_score)
    .filter((v): v is number => v != null && Number.isFinite(v));

  if (values.length < 2) {
    return (
      <div className="atelier-chart-empty">
        Not enough recovery data yet
      </div>
    );
  }

  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const latest = values[values.length - 1];
  const pts = sparklinePoints(values, 100, 100);
  const line = smoothPath(pts);
  const area = `${line} L 100,100 L 0,100 Z`;
  const axisLabels = pickAxisLabels(rows);

  return (
    <div className="atelier-recovery-chart">
      <div className="atelier-chart-meta">
        <span className="atelier-chart-fig">FIG. 02</span>
        <span>{values.length} days · avg {avg.toFixed(0)}%</span>
        <span>
          Today <span style={{ color: "#ed6f5c" }}>{latest.toFixed(0)}%</span>
        </span>
      </div>
      <div className="atelier-chart-body">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="rec-atelier-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ed6f5c" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#ed6f5c" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* 33 / 67 zone lines */}
          <line x1="0" y1="33" x2="100" y2="33" stroke="rgba(21,20,15,0.07)" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1="67" x2="100" y2="67" stroke="rgba(21,20,15,0.07)" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
          <path d={area} fill="url(#rec-atelier-area)" />
          <path
            d={line}
            fill="none"
            stroke="#ed6f5c"
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={pts[pts.length - 1][0]}
            cy={pts[pts.length - 1][1]}
            r="1.5"
            fill="#ed6f5c"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <div className="atelier-chart-axis">
        {axisLabels.map((lbl, i) => (
          <span key={`${lbl}-${i}`}>{lbl}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Sleep stage chart ───────────────────────────────────────────────────────

function SleepStageChart({ sleep }: { sleep: SleepRow | null }) {
  const deep = sleep?.deep_ms ?? 0;
  const rem = sleep?.rem_ms ?? 0;
  const light = sleep?.light_ms ?? 0;
  const awake = sleep?.awake_ms ?? 0;
  const total = deep + rem + light + awake || 1;

  const deepPct = (deep / total) * 100;
  const remPct = (rem / total) * 100;
  const lightPct = (light / total) * 100;
  const awakePct = (awake / total) * 100;

  const efficiency = sleep?.efficiency ?? null;
  const disturbances = sleep?.disturbances ?? null;
  const inBedMs = sleep?.in_bed_ms ?? null;
  const latencyMs = null; // not stored separately

  const stages = [
    { label: "DEEP", color: "#2a3a5c", ms: deep },
    { label: "REM", color: "#4a4a6a", ms: rem },
    { label: "LIGHT", color: "#8b8696", ms: light },
    { label: "AWAKE", color: "#ed6f5c", ms: awake },
  ];

  const stageDotColors = ["#2a3a5c", "#4a4a6a", "#8b8696", "#ed6f5c"];

  return (
    <div className="atelier-sleep-chart">
      {/* Stage proportional bar */}
      <div className="atelier-sleep-bar" aria-label="Sleep stages">
        <div
          style={{ flex: deepPct, background: "#2a3a5c", minWidth: deepPct > 0 ? 2 : 0 }}
          title={`Deep: ${fmtMs(deep)}`}
        />
        <div
          style={{ flex: remPct, background: "#4a4a6a", minWidth: remPct > 0 ? 2 : 0 }}
          title={`REM: ${fmtMs(rem)}`}
        />
        <div
          style={{ flex: lightPct, background: "#8b8696", minWidth: lightPct > 0 ? 2 : 0 }}
          title={`Light: ${fmtMs(light)}`}
        />
        <div
          style={{ flex: awakePct, background: "#ed6f5c", minWidth: awakePct > 0 ? 2 : 0 }}
          title={`Awake: ${fmtMs(awake)}`}
        />
      </div>

      {/* Stage legend */}
      <div className="atelier-sleep-legend">
        {stages.map((s, i) => (
          <div key={s.label} className="atelier-sleep-stage-row">
            <span className="atelier-sleep-dot" style={{ background: stageDotColors[i] }} />
            <span className="atelier-sleep-stage-label">{s.label}</span>
            <span className="atelier-sleep-stage-val">{fmtMs(s.ms)}</span>
          </div>
        ))}
      </div>

      {/* Stats row */}
      <div className="atelier-sleep-stats">
        <span>
          Efficiency{" "}
          <strong>{efficiency != null ? `${efficiency.toFixed(0)}%` : "—"}</strong>
        </span>
        <span className="atelier-sleep-dot-sep">·</span>
        <span>
          Disturbances{" "}
          <strong>{disturbances != null ? disturbances : "—"}</strong>
        </span>
        <span className="atelier-sleep-dot-sep">·</span>
        <span>
          Latency{" "}
          <strong>{latencyMs != null ? `${latencyMs}m` : "—"}</strong>
        </span>
      </div>
    </div>
  );
}

// ─── main export ─────────────────────────────────────────────────────────────

type Props = {
  recoveryTrend: RecoveryRow[];
  latestSleep: SleepRow | null;
};

export default function AtelierCharts({ recoveryTrend, latestSleep }: Props) {
  const sleepTotalStr = fmtMs(
    (latestSleep?.in_bed_ms ?? 0) - (latestSleep?.awake_ms ?? 0)
  );

  return (
    <div className="atelier-charts-row">
      {/* Left — Recovery 30-day */}
      <div className="atelier-chart-card">
        <div className="atelier-chart-header">
          <h3 className="atelier-chart-title">
            Recovery —{" "}
            <em>thirty</em> days.
          </h3>
        </div>
        <RecoveryChart rows={recoveryTrend} />
      </div>

      {/* Right — Sleep stages */}
      <div className="atelier-chart-card">
        <div className="atelier-chart-header">
          <h3 className="atelier-chart-title">Sleep stages.</h3>
          <span className="atelier-chart-sub">
            Last night · {sleepTotalStr}
          </span>
        </div>
        <SleepStageChart sleep={latestSleep} />
      </div>
    </div>
  );
}
