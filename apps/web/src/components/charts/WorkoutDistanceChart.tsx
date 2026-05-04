"use client";

import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LabelList,
  Legend,
  Cell,
} from "recharts";
import type { WorkoutRow } from "@/lib/db";
import { sportColor } from "@/lib/sport-color";

type Props = { rows: WorkoutRow[] };

const PACE_SPORTS = ["running", "cycling", "walking"] as const;

function formatShortDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export default function WorkoutDistanceChart({ rows }: Props) {
  const withDistance = rows.filter(
    (r) => r.distance_m != null && r.distance_m > 0 && r.duration_sec != null && r.duration_sec > 0,
  );

  const distanceData = withDistance
    .slice(-30)
    .map((r) => ({
      label: `${formatShortDate(r.date)} · ${r.sport ?? "—"}`,
      km: (r.distance_m as number) / 1000,
      sport: r.sport ?? "—",
    }))
    .reverse();

  const paceRows = withDistance.filter(
    (r) => r.sport != null && (PACE_SPORTS as readonly string[]).includes(r.sport),
  );

  const paceData = paceRows.map((r) => {
    const km = (r.distance_m as number) / 1000;
    const min = (r.duration_sec as number) / 60;
    return {
      date: r.date,
      pace: km > 0 ? min / km : null,
      sport: r.sport as string,
    };
  });

  const sportsInPace = Array.from(new Set(paceData.map((p) => p.sport)));
  const paceByDate = new Map<string, Record<string, number | string>>();
  for (const p of paceData) {
    if (p.pace == null || !Number.isFinite(p.pace)) continue;
    const existing = paceByDate.get(p.date) ?? { date: p.date };
    existing[p.sport] = p.pace;
    paceByDate.set(p.date, existing);
  }
  const paceChartData = Array.from(paceByDate.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );

  return (
    <>
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
              Distance by workout
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              {distanceData.length} sessions with GPS · last 30
            </div>
          </div>
        </div>
        {distanceData.length === 0 ? (
          <div className="empty-state">
            <div className="title">No GPS sessions yet</div>
            <div className="sub">Workouts with distance will appear here</div>
          </div>
        ) : (
          <div style={{ width: "100%", height: Math.max(220, distanceData.length * 22) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={distanceData}
                margin={{ top: 4, right: 60, bottom: 16, left: 8 }}
              >
                <XAxis
                  type="number"
                  tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                  axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
                  tickLine={false}
                  label={{ value: "km", position: "insideBottom", offset: -4, fill: "var(--fg-3)", fontSize: 10 }}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  tick={{ fill: "var(--fg-2)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                  axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
                  tickLine={false}
                  width={140}
                />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.04)" }}
                  contentStyle={{
                    background: "rgba(12,12,18,0.92)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                  }}
                  formatter={(v) => `${Number(v).toFixed(2)} km`}
                />
                <Bar dataKey="km" radius={[0, 3, 3, 0]}>
                  {distanceData.map((d, i) => (
                    <Cell key={i} fill={sportColor(d.sport)} />
                  ))}
                  <LabelList
                    dataKey="km"
                    position="right"
                    formatter={(v) => `${Number(v).toFixed(1)}`}
                    style={{ fill: "var(--fg-2)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
              Pace trend
            </div>
            <div className="card-sub" style={{ marginTop: 4 }}>
              min/km · lower = faster · running, cycling, walking
            </div>
          </div>
        </div>
        {paceChartData.length < 2 ? (
          <div className="empty-state">
            <div className="title">Not enough pace data</div>
            <div className="sub">Need 2+ GPS sessions in running/cycling/walking</div>
          </div>
        ) : (
          <div className="chart-body">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={paceChartData} margin={{ top: 8, right: 16, bottom: 16, left: 8 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                  axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
                  tickLine={false}
                  tickFormatter={(d: string) => formatShortDate(d)}
                />
                <YAxis
                  reversed
                  tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                  axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
                  tickLine={false}
                  tickFormatter={(v: number) => v.toFixed(1)}
                  label={{
                    value: "min/km",
                    angle: -90,
                    position: "insideLeft",
                    fill: "var(--fg-3)",
                    fontSize: 10,
                    style: { textAnchor: "middle" },
                  }}
                />
                <Tooltip
                  contentStyle={{
                    background: "rgba(12,12,18,0.92)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: 8,
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                  }}
                  formatter={(v) => `${Number(v).toFixed(2)} min/km`}
                  labelFormatter={(d) => formatShortDate(String(d))}
                />
                <Legend
                  wrapperStyle={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)" }}
                />
                {sportsInPace.map((s) => (
                  <Line
                    key={s}
                    type="monotone"
                    dataKey={s}
                    stroke={sportColor(s)}
                    strokeWidth={2}
                    dot={{ r: 2.5, fill: sportColor(s) }}
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </>
  );
}
