"use client";

import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { smoothPath } from "@/lib/paths";
import { linearSlope } from "@/lib/stats";

function linearRegression(values: number[]): { x1: number; y1: number; x2: number; y2: number } | null {
  const n = values.length;
  if (n < 3) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const slope = linearSlope(values);
  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += i; sumY += values[i]; }
  const intercept = (sumY - slope * sumX) / n;

  const yAt = (x: number) => 100 - ((slope * x + intercept - min) / range) * 100;
  return { x1: 0, y1: yAt(0), x2: 100, y2: yAt(n - 1) };
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

type RollingMode = "raw" | "7d" | "30d";

type DataPoint = { date: string; value: number | null };

type Props = {
  title: string;
  subtitle?: string;
  color: string;
  gradientId: string;
  data: DataPoint[];
  unit?: string;
  showRollingToggle?: boolean;
};

type Tooltip = {
  x: number;
  y: number;
  date: string;
  value: number;
  rolling: number | null;
  pct: number;
  svgY: number;
};

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

function formatTick(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(0);
  if (abs >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

export default function TrendChart({
  title,
  subtitle,
  color,
  gradientId,
  data,
  unit = "",
  showRollingToggle = false,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const [showTrendline, setShowTrendline] = useState(false);
  const [rollingMode, setRollingMode] = useState<RollingMode>("raw");

  useEffect(() => {
    setShowTrendline(localStorage.getItem("trendline") === "1");
  }, []);

  const valid = data.filter((d): d is { date: string; value: number } => d.value != null && Number.isFinite(d.value));

  const rolling = useMemo(() => {
    if (!showRollingToggle || rollingMode === "raw") return null;
    const window = rollingMode === "7d" ? 7 : 30;
    const allVals = data.map((d) => d.value);
    const allRolling = rollingMean(allVals, window);
    return data.reduce<(number | null)[]>((acc, d, i) => {
      if (d.value != null && Number.isFinite(d.value)) acc.push(allRolling[i]);
      return acc;
    }, []);
  }, [data, rollingMode, showRollingToggle]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!bodyRef.current || valid.length < 2) return;
    const rect = bodyRef.current.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(xPct * (valid.length - 1));
    const clamped = Math.max(0, Math.min(valid.length - 1, idx));
    const pt = valid[clamped];

    const baseValues = valid.map((d) => d.value);
    const allValues = rolling
      ? [...baseValues, ...rolling.filter((v): v is number => v != null)]
      : baseValues;
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const range = max - min || 1;
    const svgY = 100 - ((pt.value - min) / range) * 100;
    const pct = (clamped / (valid.length - 1)) * 100;

    const rawX = (clamped / (valid.length - 1)) * rect.width;
    const tooltipWidth = 130;
    const x = Math.min(Math.max(rawX, tooltipWidth / 2), rect.width - tooltipWidth / 2);

    setTooltip({
      x,
      y: (svgY / 100) * rect.height,
      date: pt.date,
      value: pt.value,
      rolling: rolling ? rolling[clamped] : null,
      pct,
      svgY,
    });
  }, [valid, rolling]);

  if (valid.length < 2) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: color, color }} />
              {title}
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

  const baseValues = valid.map((d) => d.value);
  const avg = baseValues.reduce((a, b) => a + b, 0) / baseValues.length;
  const latest = baseValues[baseValues.length - 1];
  const allValues = rolling
    ? [...baseValues, ...rolling.filter((v): v is number => v != null)]
    : baseValues;
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;
  const trendLine = showTrendline ? linearRegression(baseValues) : null;

  const points = valid.map<[number, number]>((d, i) => [
    (i / (valid.length - 1)) * 100,
    100 - ((d.value - min) / range) * 100,
  ]);
  const linePath = smoothPath(points);
  const areaPath = `${linePath} L 100,100 L 0,100 Z`;
  const endY = 100 - ((latest - min) / range) * 100;
  const axis = pickAxis(valid);

  const rollingPoints: [number, number][] = [];
  if (rolling) {
    rolling.forEach((v, i) => {
      if (v == null) return;
      rollingPoints.push([
        (i / (valid.length - 1)) * 100,
        100 - ((v - min) / range) * 100,
      ]);
    });
  }
  const rollingLinePath = rollingPoints.length > 1 ? smoothPath(rollingPoints) : "";

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: color, color }} />
            {title}
          </div>
          {subtitle && (
            <div className="card-sub" style={{ marginTop: 4 }}>
              {subtitle} · avg {avg.toFixed(1)}{unit}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <span className="card-sub">
            Latest&nbsp;<span style={{ color }}>{latest.toFixed(1)}{unit}</span>
          </span>
          {showRollingToggle && <RollingToggle mode={rollingMode} onChange={setRollingMode} color={color} />}
        </div>
      </div>

      <div className="chart-body" style={{ position: "relative", paddingLeft: 28 }}>
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 24,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            pointerEvents: "none",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--fg-3)",
            textAlign: "right",
            paddingRight: 4,
            letterSpacing: "0.02em",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>{formatTick(max)}{unit}</span>
          <span>{formatTick((min + max) / 2)}{unit}</span>
          <span>{formatTick(min)}{unit}</span>
        </div>
        <div
          ref={bodyRef}
          style={{ position: "relative", cursor: "crosshair", width: "100%", height: "100%" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setTooltip(null)}
        >
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block", overflow: "visible" }}>
          <defs>
            <linearGradient id={`${gradientId}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${gradientId}-line`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={color} stopOpacity="0.7" />
              <stop offset="100%" stopColor={color} />
            </linearGradient>
          </defs>
          <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.04)" strokeDasharray="0.3 0.6" strokeWidth="0.2" vectorEffect="non-scaling-stroke" />
          <path d={areaPath} fill={`url(#${gradientId}-area)`} />
          <path d={linePath} fill="none" stroke={`url(#${gradientId}-line)`} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {rollingLinePath && (
            <path
              d={rollingLinePath}
              fill="none"
              stroke={color}
              strokeOpacity="0.55"
              strokeWidth="2.4"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
          <circle cx="100" cy={endY} r="1.2" fill={color} vectorEffect="non-scaling-stroke" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
          {trendLine && (
            <line
              x1={trendLine.x1} y1={trendLine.y1}
              x2={trendLine.x2} y2={trendLine.y2}
              stroke="rgba(255,255,255,0.45)"
              strokeWidth="0.6"
              strokeDasharray="2 1.5"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {tooltip && (
            <>
              <line
                x1={tooltip.pct} y1="0" x2={tooltip.pct} y2="100"
                stroke="rgba(255,255,255,0.12)" strokeWidth="0.3" vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={tooltip.pct} cy={tooltip.svgY} r="1.5"
                fill={color} stroke="rgba(5,5,10,0.9)" strokeWidth="0.6"
                vectorEffect="non-scaling-stroke"
                style={{ filter: `drop-shadow(0 0 4px ${color})` }}
              />
            </>
          )}
        </svg>

        {tooltip && (
          <div style={{
            position: "absolute",
            top: Math.max(0, tooltip.y - (tooltip.rolling != null ? 72 : 52)),
            left: tooltip.x,
            transform: "translateX(-50%)",
            pointerEvents: "none",
            background: "rgba(12,12,18,0.92)",
            border: `1px solid ${color}44`,
            borderRadius: 8,
            padding: "6px 10px",
            backdropFilter: "blur(8px)",
            boxShadow: `0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px ${color}22`,
            whiteSpace: "nowrap",
            zIndex: 10,
          }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)", marginBottom: 2 }}>
              {formatDate(tooltip.date)}
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 500, color, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
              {tooltip.value.toFixed(1)}<span style={{ fontSize: 11, color: "var(--fg-3)", marginLeft: 2 }}>{unit}</span>
            </div>
            {tooltip.rolling != null && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 2 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-3)" }}>
                  {rollingMode} avg
                </span>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 13, color, opacity: 0.75, fontVariantNumeric: "tabular-nums" }}>
                  {tooltip.rolling.toFixed(1)}<span style={{ fontSize: 10, color: "var(--fg-3)", marginLeft: 2 }}>{unit}</span>
                </span>
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      <div className="chart-axis" style={{ paddingLeft: 28 }}>
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
