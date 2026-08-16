"use client";

import { useRef, useState, useCallback, useMemo } from "react";
import { smoothPath } from "@/lib/paths";

type DataPoint = { date: string; hrv: number | null };

type Props = {
  subtitle?: string;
  data: DataPoint[];
};

type RollingMode = "raw" | "7d" | "30d";

type Tooltip = {
  x: number;
  y: number;
  date: string;
  raw: number;
  rolling: number | null;
  pct: number;
  svgY: number;
  anomaly: { baseline: number; pctBelow: number } | null;
};

const COLOR = "#7b61ff";
const ANOMALY_COLOR = "#ff3b3b";
const GRADIENT_ID = "hrv-trend";
const ANOMALY_WINDOW = 30;
const ANOMALY_MIN_PERIODS = 14;
const ANOMALY_SIGMA = 1.5;

function rollingMeanStd(
  values: (number | null)[],
): { mean: number | null; std: number | null }[] {
  return values.map((_, i) => {
    const window = values
      .slice(Math.max(0, i - (ANOMALY_WINDOW - 1)), i + 1)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (window.length < ANOMALY_MIN_PERIODS) return { mean: null, std: null };
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance =
      window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length;
    return { mean, std: Math.sqrt(variance) };
  });
}

function pickAxis(data: DataPoint[]): string[] {
  if (data.length === 0) return [];
  const idx = [0, Math.floor(data.length / 4), Math.floor(data.length / 2), Math.floor((data.length * 3) / 4), data.length - 1];
  return Array.from(new Set(idx)).map((i) => {
    const d = new Date(data[i].date + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

function rollingMean(values: (number | null)[], windowSize: number): (number | null)[] {
  return values.map((_, i) => {
    const window = values
      .slice(Math.max(0, i - (windowSize - 1)), i + 1)
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (window.length === 0) return null;
    return window.reduce((a, b) => a + b, 0) / window.length;
  });
}

export default function HRVTrend({ subtitle, data }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [mode, setMode] = useState<RollingMode>("7d");

  const valid = data.filter((d): d is { date: string; hrv: number } =>
    d.hrv != null && Number.isFinite(d.hrv)
  );
  const rolling = useMemo(() => {
    if (mode === "raw") return null;
    const window = mode === "7d" ? 7 : 30;
    return rollingMean(data.map((d) => d.hrv), window);
  }, [data, mode]);
  const stats = useMemo(() => rollingMeanStd(data.map((d) => d.hrv)), [data]);
  const validIndices = data.reduce<number[]>((acc, d, i) => {
    if (d.hrv != null && Number.isFinite(d.hrv)) acc.push(i);
    return acc;
  }, []);

  const anomalies = useMemo(() => {
    const map = new Map<number, { baseline: number; pctBelow: number }>();
    data.forEach((d, i) => {
      if (d.hrv == null || !Number.isFinite(d.hrv)) return;
      const s = stats[i];
      if (s.mean == null || s.std == null || s.std === 0) return;
      if (d.hrv < s.mean - ANOMALY_SIGMA * s.std) {
        const pctBelow = ((s.mean - d.hrv) / s.mean) * 100;
        map.set(i, { baseline: s.mean, pctBelow });
      }
    });
    return map;
  }, [data, stats]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!bodyRef.current || valid.length < 2) return;
    const rect = bodyRef.current.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(xPct * (valid.length - 1));
    const clamped = Math.max(0, Math.min(valid.length - 1, idx));
    const pt = valid[clamped];
    const originalIdx = validIndices[clamped];

    const rawValues = valid.map((d) => d.hrv);
    const rollingValues = rolling ? rolling.filter((v): v is number => v != null) : [];
    const allValues = [...rawValues, ...rollingValues];
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const range = max - min || 1;
    const svgY = 100 - ((pt.hrv - min) / range) * 100;
    const pct = (clamped / (valid.length - 1)) * 100;

    const rawX = (clamped / (valid.length - 1)) * rect.width;
    const tooltipWidth = 150;
    const x = Math.min(Math.max(rawX, tooltipWidth / 2), rect.width - tooltipWidth / 2);

    setTooltip({
      x,
      y: (svgY / 100) * rect.height,
      date: pt.date,
      raw: pt.hrv,
      rolling: rolling ? rolling[originalIdx] : null,
      pct,
      svgY,
      anomaly: anomalies.get(originalIdx) ?? null,
    });
  }, [valid, rolling, validIndices, anomalies]);

  if (valid.length < 2) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: COLOR, color: COLOR }} />
              HRV trend
            </div>
            {subtitle && <div className="card-sub" style={{ marginTop: 4 }}>{subtitle}</div>}
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Not enough data yet</div>
          <div className="sub">Sync Whoop to populate this chart</div>
        </div>
      </div>
    );
  }

  const rawValues = valid.map((d) => d.hrv);
  const rollingValues = rolling ? rolling.filter((v): v is number => v != null) : [];
  const allValues = [...rawValues, ...rollingValues];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const avg = rawValues.reduce((a, b) => a + b, 0) / rawValues.length;
  const latest = rawValues[rawValues.length - 1];

  const rawPoints = valid.map<[number, number]>((d, i) => [
    (i / (valid.length - 1)) * 100,
    100 - ((d.hrv - min) / range) * 100,
  ]);
  const rawLinePath = smoothPath(rawPoints);

  const rollingPoints: [number, number][] = [];
  if (rolling) {
    rolling.forEach((v, i) => {
      if (v == null) return;
      const xIdx = validIndices.indexOf(i);
      if (xIdx === -1) return;
      rollingPoints.push([
        (xIdx / (valid.length - 1)) * 100,
        100 - ((v - min) / range) * 100,
      ]);
    });
  }
  const rollingLinePath = rollingPoints.length > 1 ? smoothPath(rollingPoints) : "";
  const rollingAreaPath = rollingPoints.length > 1
    ? `${rollingLinePath} L ${rollingPoints[rollingPoints.length - 1][0]},100 L ${rollingPoints[0][0]},100 Z`
    : "";

  const endY = 100 - ((latest - min) / range) * 100;
  const axis = pickAxis(valid);
  const subtitleSuffix = mode === "raw" ? "raw" : `${mode} avg overlay`;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: COLOR, color: COLOR }} />
            HRV trend
          </div>
          {subtitle && (
            <div className="card-sub" style={{ marginTop: 4 }}>
              {subtitle} · {subtitleSuffix} · avg {avg.toFixed(1)} ms
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <span className="card-sub">
            Latest&nbsp;<span style={{ color: COLOR }}>{latest.toFixed(1)} ms</span>
          </span>
          <RollingToggle mode={mode} onChange={setMode} color={COLOR} />
        </div>
      </div>

      <div
        ref={bodyRef}
        className="chart-body"
        style={{ position: "relative", cursor: "crosshair" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}>
          <defs>
            <linearGradient id={`${GRADIENT_ID}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLOR} stopOpacity="0.35" />
              <stop offset="100%" stopColor={COLOR} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${GRADIENT_ID}-line`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={COLOR} stopOpacity="0.7" />
              <stop offset="100%" stopColor={COLOR} />
            </linearGradient>
          </defs>
          <line x1="0" y1="33" x2="100" y2="33" stroke="rgba(255,255,255,0.04)" strokeDasharray="0.3 0.6" strokeWidth="0.2" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1="66" x2="100" y2="66" stroke="rgba(255,255,255,0.04)" strokeDasharray="0.3 0.6" strokeWidth="0.2" vectorEffect="non-scaling-stroke" />

          {rollingAreaPath && <path d={rollingAreaPath} fill={`url(#${GRADIENT_ID}-area)`} />}

          <path
            d={rawLinePath}
            fill="none"
            stroke={COLOR}
            strokeOpacity={mode === "raw" ? 0.85 : 0.35}
            strokeWidth={mode === "raw" ? 1.5 : 0.8}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {mode !== "raw" && rawPoints.map(([x, y], i) => (
            <circle
              key={`raw-${i}`}
              cx={x}
              cy={y}
              r="0.7"
              fill={COLOR}
              fillOpacity="0.5"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {rawPoints.map(([x, y], i) => {
            const originalIdx = validIndices[i];
            if (!anomalies.has(originalIdx)) return null;
            return (
              <circle
                key={`anom-${i}`}
                cx={x}
                cy={y}
                r="1.4"
                fill={ANOMALY_COLOR}
                stroke="rgba(5,5,10,0.9)"
                strokeWidth="0.4"
                vectorEffect="non-scaling-stroke"
                style={{ filter: `drop-shadow(0 0 3px ${ANOMALY_COLOR})` }}
              />
            );
          })}

          {rollingLinePath && (
            <path
              d={rollingLinePath}
              fill="none"
              stroke={`url(#${GRADIENT_ID}-line)`}
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}

          <circle cx="100" cy={endY} r="1.2" fill={COLOR} vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 3px ${COLOR})` }} />

          {tooltip && (
            <>
              <line
                x1={tooltip.pct} y1="0" x2={tooltip.pct} y2="100"
                stroke="rgba(255,255,255,0.12)" strokeWidth="0.3" vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={tooltip.pct} cy={tooltip.svgY} r="1.5"
                fill={COLOR} stroke="rgba(5,5,10,0.9)" strokeWidth="0.6"
                vectorEffect="non-scaling-stroke"
                style={{ filter: `drop-shadow(0 0 4px ${COLOR})` }}
              />
            </>
          )}
        </svg>

        {tooltip && (
          <div style={{
            position: "absolute",
            top: Math.max(0, tooltip.y - 72),
            left: tooltip.x,
            transform: "translateX(-50%)",
            pointerEvents: "none",
            background: "rgba(12,12,18,0.92)",
            border: `1px solid ${COLOR}44`,
            borderRadius: 8,
            padding: "6px 10px",
            backdropFilter: "blur(8px)",
            boxShadow: `0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px ${COLOR}22`,
            whiteSpace: "nowrap",
            zIndex: 10,
          }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)", marginBottom: 4 }}>
              {formatDate(tooltip.date)}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-3)", opacity: 0.7 }}>raw</span>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 14, color: COLOR, opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>
                {tooltip.raw.toFixed(1)}<span style={{ fontSize: 10, color: "var(--fg-3)", marginLeft: 2 }}>ms</span>
              </span>
            </div>
            {mode !== "raw" && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-3)" }}>{mode} avg</span>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 16, fontWeight: 500, color: COLOR, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                  {tooltip.rolling != null ? tooltip.rolling.toFixed(1) : "—"}<span style={{ fontSize: 10, color: "var(--fg-3)", marginLeft: 2 }}>ms</span>
                </span>
              </div>
            )}
            {tooltip.anomaly && (
              <div style={{ marginTop: 4, fontSize: 10, color: ANOMALY_COLOR, fontFamily: "var(--font-mono)" }}>
                HRV {tooltip.raw.toFixed(1)} ms — {Math.round(tooltip.anomaly.pctBelow)}% below your 30d baseline
              </div>
            )}
          </div>
        )}
      </div>

      <div className="chart-axis">
        {axis.map((label, i) => (
          <span key={`${label}-${i}`}>{label}</span>
        ))}
      </div>
    </div>
  );
}

function RollingToggle({
  mode,
  onChange,
  color,
}: {
  mode: RollingMode;
  onChange: (m: RollingMode) => void;
  color: string;
}) {
  const opts: RollingMode[] = ["raw", "7d", "30d"];
  return (
    <div style={{ display: "inline-flex", gap: 2, padding: 2, background: "rgba(255,255,255,0.04)", borderRadius: 6 }}>
      {opts.map((opt) => {
        const active = mode === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className="card-sub"
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              border: "none",
              background: active ? `${color}22` : "transparent",
              color: active ? color : "var(--fg-3)",
              cursor: "pointer",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.02em",
              textTransform: "lowercase",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}
