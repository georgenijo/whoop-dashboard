"use client";

import {
  ComposedChart,
  Scatter,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type {
  CardiacDriftReport,
  CardiacDriftSport,
} from "@/lib/analytics/cardiacDrift";
import { sportColor } from "@/lib/sport-color";

type Props = { report: CardiacDriftReport };

const MAX_SPORTS_RENDERED = 5;

function formatShortDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

function reasonLabel(
  reason: "too_few_workouts" | "too_short_span",
  count: number,
  span: number,
): string {
  if (reason === "too_few_workouts") {
    return `too few duration-matched workouts (${count})`;
  }
  return `span too short (${span}d, need ≥28d)`;
}

export default function CardiacDriftCard({ report }: Props) {
  const { qualifying, belowThreshold } = report;
  const isEmpty = qualifying.length === 0 && belowThreshold.length === 0;

  if (isEmpty) {
    return (
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <span
                className="dot"
                style={{ background: "#ff8c00", color: "#ff8c00" }}
              />
              Cardiac drift
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              avg HR regression on duration-matched workouts
            </div>
          </div>
        </div>
        <div className="empty-state">
          <div className="title">No workouts with HR data yet</div>
          <div className="sub">Sync Whoop to populate this card</div>
        </div>
      </div>
    );
  }

  const visible = qualifying.slice(0, MAX_SPORTS_RENDERED);
  const hidden = qualifying.length - visible.length;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span
              className="dot"
              style={{ background: "#ff8c00", color: "#ff8c00" }}
            />
            Cardiac drift
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            avg HR regression on duration-matched workouts (median ±25%)
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div
          className="card-sub"
          style={{ marginTop: 12, color: "var(--fg-2)" }}
        >
          No sports yet meet ≥3 workouts and ≥28d span — see below.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            marginTop: 16,
          }}
        >
          {visible.map((s) => (
            <SportPanel key={s.sport} sport={s} />
          ))}
        </div>
      )}

      {hidden > 0 && (
        <div
          className="card-sub"
          style={{ marginTop: 12, color: "var(--fg-3)" }}
        >
          + {hidden} more qualifying {hidden === 1 ? "sport" : "sports"} not
          shown
        </div>
      )}

      {belowThreshold.length > 0 && (
        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--fg-3)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Insufficient data
          </div>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            {belowThreshold.map((b) => (
              <li
                key={b.sport}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--fg-2)",
                }}
              >
                <span style={{ color: sportColor(b.sport) }}>{b.sport}</span>
                <span style={{ color: "var(--fg-3)" }}>
                  {reasonLabel(b.reason, b.workout_count, b.date_span_days)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SportPanel({ sport }: { sport: CardiacDriftSport }) {
  const color = sportColor(sport.sport);
  const driftColor = sport.drift_detected ? "#ff6b6b" : "#00d4aa";
  const driftLabel = sport.drift_detected ? "DRIFT DETECTED" : "Stable";

  const points = sport.dates.map((d, i) => ({
    day: i === 0 ? 0 : daysBetween(sport.dates[0], d),
    avg_hr: sport.avg_hrs[i],
    date: d,
  }));

  const span = sport.date_span_days;
  const lineData = [
    { day: 0, fit: sport.intercept },
    { day: span, fit: sport.intercept + sport.slope * span },
  ];

  const allHrs = points.map((p) => p.avg_hr).concat(lineData.map((l) => l.fit));
  const xMin = 0;
  const xMax = span;
  const yMin = Math.floor(Math.min(...allHrs) - 2);
  const yMax = Math.ceil(Math.max(...allHrs) + 2);

  const slopeStr =
    (sport.slope_per_28d >= 0 ? "+" : "") + sport.slope_per_28d.toFixed(1);
  const r2Str = sport.r_squared.toFixed(2);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: color,
              display: "inline-block",
            }}
          />
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 600,
              color: "var(--fg-0)",
              fontSize: 13,
            }}
          >
            {sport.sport}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--fg-3)",
            }}
          >
            {sport.workout_count} sessions · {sport.date_span_days}d ·{" "}
            {formatDuration(sport.median_duration_sec)} median
          </span>
        </div>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.06em",
            color: driftColor,
            border: `1px solid ${driftColor}`,
            padding: "2px 8px",
            borderRadius: 4,
            background: `${driftColor}14`,
          }}
        >
          {driftLabel}
        </span>
      </div>

      <div style={{ width: "100%", height: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 8, right: 16, bottom: 18, left: 8 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
            <XAxis
              type="number"
              dataKey="day"
              domain={[xMin, xMax]}
              ticks={tickList(xMin, xMax)}
              tick={{
                fill: "var(--fg-3)",
                fontSize: 10,
                fontFamily: "var(--font-mono)",
              }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
              tickLine={false}
              tickFormatter={(v: number) => {
                const idx = points.findIndex((p) => p.day === v);
                if (idx >= 0) return formatShortDate(points[idx].date);
                if (v === 0) return formatShortDate(sport.dates[0]);
                if (v === span)
                  return formatShortDate(sport.dates[sport.dates.length - 1]);
                return `${v}d`;
              }}
            />
            <YAxis
              type="number"
              dataKey="avg_hr"
              domain={[yMin, yMax]}
              tick={{
                fill: "var(--fg-3)",
                fontSize: 10,
                fontFamily: "var(--font-mono)",
              }}
              axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
              tickLine={false}
              label={{
                value: "avg HR",
                angle: -90,
                position: "insideLeft",
                fill: "var(--fg-3)",
                fontSize: 10,
                style: { textAnchor: "middle" },
              }}
            />
            <Tooltip
              cursor={{ stroke: "rgba(255,255,255,0.08)", strokeWidth: 1 }}
              contentStyle={{
                background: "rgba(12,12,18,0.92)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
              formatter={(value, name) => {
                if (name === "fit") return [`${Number(value).toFixed(1)} bpm`, "regression"];
                return [`${Number(value).toFixed(0)} bpm`, "avg HR"];
              }}
              labelFormatter={(_v, payload) => {
                const p = payload && payload[0]?.payload;
                if (p && p.date) return formatShortDate(p.date);
                return "";
              }}
            />
            <Scatter data={points} fill={color} name="avg HR" />
            <Line
              data={lineData}
              dataKey="fit"
              stroke={driftColor}
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
              isAnimationActive={false}
              legendType="none"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          marginTop: 4,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--fg-2)",
        }}
      >
        <span>
          slope/28d:{" "}
          <span style={{ color: driftColor, fontWeight: 600 }}>
            {slopeStr} bpm
          </span>
        </span>
        <span>
          R²: <span style={{ color: "var(--fg-1)" }}>{r2Str}</span>
        </span>
      </div>
    </div>
  );
}

function daysBetween(a: string, b: string): number {
  const ad = Date.UTC(
    Number(a.slice(0, 4)),
    Number(a.slice(5, 7)) - 1,
    Number(a.slice(8, 10)),
  );
  const bd = Date.UTC(
    Number(b.slice(0, 4)),
    Number(b.slice(5, 7)) - 1,
    Number(b.slice(8, 10)),
  );
  return Math.round((bd - ad) / (1000 * 60 * 60 * 24));
}

function tickList(min: number, max: number): number[] {
  if (max <= min) return [min];
  const target = 5;
  const step = Math.max(1, Math.round((max - min) / (target - 1)));
  const ticks: number[] = [];
  for (let v = min; v <= max; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] !== max) ticks.push(max);
  return ticks;
}
