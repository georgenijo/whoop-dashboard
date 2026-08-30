import type { IllnessRow } from "@/lib/analytics/illness";

type Props = {
  rows: IllnessRow[];
  rangeLabel: string;
};

const SIGNAL_COLORS = ["#00d4aa", "#ffd166", "#ffaa00", "#ff3b3b"];

function statusFor(count: number): { label: string; color: string } {
  if (count >= 2) return { label: "Likely illness onset", color: SIGNAL_COLORS[3] };
  if (count === 1) return { label: "Watch", color: SIGNAL_COLORS[1] };
  return { label: "Healthy", color: SIGNAL_COLORS[0] };
}

function formatShort(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function pickAxis(rows: IllnessRow[]): string[] {
  if (rows.length === 0) return [];
  const idx = [
    0,
    Math.floor(rows.length / 4),
    Math.floor(rows.length / 2),
    Math.floor((rows.length * 3) / 4),
    rows.length - 1,
  ];
  return Array.from(new Set(idx)).map((i) => formatShort(rows[i].date));
}

export default function IllnessSignalCard({ rows, rangeLabel }: Props) {
  const baselined = rows.filter((r) => r.rhr_baseline != null);

  if (baselined.length === 0) {
    return (
      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: "#ffaa00", color: "#ffaa00" }} />
              Illness signal
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              14-day baseline · RHR · HRV · skin temp
            </div>
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Need 7+ days of recovery data</div>
          <div className="sub">Baseline computes once a week of history is in</div>
        </div>
      </div>
    );
  }

  const today = baselined[baselined.length - 1];
  const status = statusFor(today.signal_count);
  const strip = baselined;
  const anyHasSkinTemp = baselined.some((r) => r.has_skin_temp);
  const anyHasRespRate = baselined.some((r) => r.respiratory_rate != null);

  return (
    <div className="card" style={{ marginTop: 24 }}>
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: status.color, color: status.color }} />
            Illness signal
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            {rangeLabel} · 14-day rolling baseline · {baselined.length} days with data
          </div>
        </div>
        <span className="card-sub">
          Today&nbsp;
          <span style={{ color: status.color }}>
            {today.signal_count}/3 · {status.label}
          </span>
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <FlagsToday row={today} />
        <DayStrip rows={strip} />
        <DeviationChart rows={strip} />
        {!anyHasSkinTemp && (
          <div className="card-sub" style={{ color: "var(--fg-3)" }}>
            Skin temperature unavailable (Whoop pre-4.0 strap)
          </div>
        )}
        {!anyHasRespRate && (
          <div className="card-sub" style={{ color: "var(--fg-3)" }}>
            Respiratory rate unavailable for this window
          </div>
        )}
      </div>
    </div>
  );
}

function FlagsToday({ row }: { row: IllnessRow }) {
  const items: Array<{ label: string; value: string; flagged: boolean; muted?: boolean }> = [
    {
      label: "RHR",
      value:
        row.rhr_dev != null ? `${row.rhr_dev >= 0 ? "+" : ""}${row.rhr_dev.toFixed(1)} bpm` : "—",
      flagged: row.rhr_flag,
    },
    {
      label: "HRV",
      value:
        row.hrv_dev != null ? `${row.hrv_dev >= 0 ? "+" : ""}${row.hrv_dev.toFixed(1)}%` : "—",
      flagged: row.hrv_flag,
    },
    {
      label: "Skin temp",
      value:
        row.skin_temp_dev != null
          ? `${row.skin_temp_dev >= 0 ? "+" : ""}${row.skin_temp_dev.toFixed(2)} °C`
          : "—",
      flagged: row.skin_temp_flag,
    },
    {
      label: "Resp rate",
      value:
        row.resp_rate_dev != null
          ? `${row.resp_rate_dev >= 0 ? "+" : ""}${row.resp_rate_dev.toFixed(1)} brpm`
          : "—",
      flagged: row.resp_rate_flag,
      muted: true,
    },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: 10,
      }}
    >
      {items.map((it) => (
        <div
          key={it.label}
          style={{
            border: `1px solid ${it.flagged ? "rgba(255,59,59,0.45)" : "rgba(255,255,255,0.06)"}`,
            borderRadius: 8,
            padding: "10px 12px",
            background: it.flagged ? "rgba(255,59,59,0.08)" : "rgba(255,255,255,0.02)",
            opacity: it.muted ? 0.75 : 1,
          }}
        >
          <div
            className="card-sub"
            style={{ marginBottom: 4 }}
            title={it.muted ? "Informational only — not in signal count" : undefined}
          >
            {it.label}
            {it.muted ? " (info)" : ""}
          </div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 16,
              color: it.flagged ? "#ff3b3b" : "var(--fg-1)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {it.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function DayStrip({ rows }: { rows: IllnessRow[] }) {
  return (
    <div>
      <div className="card-sub" style={{ marginBottom: 6 }}>
        Last {rows.length} days
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {rows.map((r) => (
          <div
            key={r.date}
            title={`${formatShort(r.date)} · signal ${r.signal_count}/3`}
            style={{
              width: 14,
              height: 14,
              borderRadius: 4,
              background: SIGNAL_COLORS[Math.min(r.signal_count, 3)],
              opacity: r.signal_count === 0 ? 0.5 : 1,
              boxShadow:
                r.signal_count >= 2
                  ? `0 0 6px ${SIGNAL_COLORS[Math.min(r.signal_count, 3)]}`
                  : "none",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function DeviationChart({ rows }: { rows: IllnessRow[] }) {
  // Grouped bars per day: RHR (bpm), HRV (%), skin temp (°C * 10), resp rate (brpm muted).
  // Each metric is independently scaled into a [-50, 50] band centered on 0.
  const series = [
    { key: "rhr", label: "RHR", color: "#ff6b6b", values: rows.map((r) => r.rhr_dev) },
    { key: "hrv", label: "HRV", color: "#7b61ff", values: rows.map((r) => r.hrv_dev) },
    {
      key: "skin",
      label: "Skin temp",
      color: "#ffaa00",
      values: rows.map((r) => (r.skin_temp_dev != null ? r.skin_temp_dev * 10 : null)),
    },
    {
      key: "resp",
      label: "Resp",
      color: "#00aaff",
      values: rows.map((r) => r.resp_rate_dev),
      muted: true,
    },
  ].filter((s) => s.values.some((v) => v != null && Number.isFinite(v)));

  if (series.length === 0 || rows.length === 0) {
    return (
      <div className="empty-state" style={{ minHeight: 120 }}>
        <div className="title">No deviation data</div>
        <div className="sub">Need at least one day past the 7-day baseline</div>
      </div>
    );
  }

  const allValues = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const maxAbs = Math.max(3, ...allValues.map((v) => Math.abs(v)));
  const groupCount = rows.length;
  const groupWidth = 100 / groupCount;
  const barWidth = (groupWidth / series.length) * 0.8;
  const axis = pickAxis(rows);

  return (
    <div>
      <div
        className="card-sub"
        style={{
          marginBottom: 6,
          display: "flex",
          gap: 14,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span>Deviation from baseline</span>
        {series.map((s) => (
          <span key={s.key} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 2,
                background: s.color,
                opacity: s.muted ? 0.55 : 1,
              }}
            />
            {s.label}
            {s.key === "skin" ? " (°C×10)" : s.muted ? " (info)" : ""}
          </span>
        ))}
      </div>
      <div className="chart-body" style={{ height: 180 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none">
          <line
            x1="0"
            y1="50"
            x2="100"
            y2="50"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="0.3"
            vectorEffect="non-scaling-stroke"
          />
          {rows.map((_, i) => {
            const groupX = i * groupWidth;
            return series.map((s, j) => {
              const v = s.values[i];
              if (v == null || !Number.isFinite(v)) return null;
              const heightPct = (Math.abs(v) / maxAbs) * 50;
              const x = groupX + j * (groupWidth / series.length) + (groupWidth / series.length - barWidth) / 2;
              const y = v >= 0 ? 50 - heightPct : 50;
              return (
                <rect
                  key={`${i}-${s.key}`}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={heightPct}
                  fill={s.color}
                  opacity={s.muted ? 0.55 : 0.9}
                  vectorEffect="non-scaling-stroke"
                />
              );
            });
          })}
        </svg>
      </div>
      <div className="chart-axis">
        {axis.map((label, i) => (
          <span key={`${label}-${i}`}>{label}</span>
        ))}
      </div>
    </div>
  );
}
