"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceArea,
  Cell,
} from "recharts";
import type { SleepRow } from "@/lib/db";

type Props = { rows: SleepRow[]; rangeLabel: string };

const CHART_HOURS = 16;
const HOUR_TICKS = [0, 4, 8, 12, 16];
const HOUR_LABELS: Record<number, string> = {
  0: "8pm",
  4: "12am",
  8: "4am",
  12: "8am",
  16: "12pm",
};

function parseLocalDateTime(s: string | null): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** The calendar date `d` was constructed with, read back via the same
 *  local getters `hoursFrom8pm` uses — `parseLocalDateTime` builds `d` from
 *  the naive local ISO's numeric components directly, so this round-trips
 *  those exact numbers regardless of the runtime's own timezone. Used to
 *  label bedtime and wake time with their OWN calendar day: `r.date`
 *  (issue #440) is the wake day, so for a midnight-spanning night the bed
 *  time actually happened the evening BEFORE `r.date`, and showing just
 *  `r.date` above both timestamps would misleadingly imply the bedtime
 *  happened on the wake day too. */
function localDatePart(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function hoursFrom8pm(d: Date): number {
  const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  return ((h - 20 + 24) % 24);
}

function formatClock(hoursFrom20: number): string {
  const totalMin = ((20 + hoursFrom20) * 60) % (24 * 60);
  const h24 = Math.floor(totalMin / 60);
  const m = Math.round(totalMin % 60);
  const period = h24 >= 12 ? "pm" : "am";
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${h12}:${m.toString().padStart(2, "0")}${period}`;
}

function formatShortDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatLongDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

type Datum = {
  date: string;
  /** Calendar date of the bed timestamp — may be the day BEFORE `date` for
   *  a midnight-spanning night. */
  bedDate: string;
  /** Calendar date of the wake timestamp — equals `date` (issue #440: rows
   *  are now filed under their wake day). */
  wakeDate: string;
  bed: number;
  wake: number;
  duration: number;
  bedClock: string;
  wakeClock: string;
};

function TimelineTooltip({ active, payload }: { active?: boolean; payload?: { payload: Datum }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  // Same-day sleep (no midnight span): one date label is unambiguous. A
  // midnight-spanning night shows both days so the bed time isn't
  // misattributed to the wake day it's labeled by on the y-axis.
  const dateLabel =
    d.bedDate === d.wakeDate
      ? formatLongDate(d.bedDate)
      : `${formatShortDate(d.bedDate)} → ${formatShortDate(d.wakeDate)}`;
  return (
    <div
      style={{
        background: "rgba(12,12,18,0.92)",
        border: "1px solid #7b61ff66",
        borderRadius: 8,
        padding: "6px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
      }}
    >
      <div style={{ color: "var(--fg-3)", marginBottom: 2 }}>{dateLabel}</div>
      <div style={{ color: "var(--fg-1)" }}>
        {d.bedClock} → {d.wakeClock}
        <span style={{ color: "var(--fg-3)", marginLeft: 6 }}>· {d.duration.toFixed(1)}h</span>
      </div>
    </div>
  );
}

export default function BedWakeTimeline({ rows, rangeLabel }: Props) {
  const eligible = rows
    .filter((r) => r.start_local && r.end_local);

  const data: Datum[] = [];
  for (const r of eligible) {
    const startDt = parseLocalDateTime(r.start_local);
    const endDt = parseLocalDateTime(r.end_local);
    if (!startDt || !endDt) continue;
    const bed = hoursFrom8pm(startDt);
    const rawWake = hoursFrom8pm(endDt);
    const wake = rawWake < bed ? rawWake + 24 : rawWake;
    if (bed > CHART_HOURS && wake > CHART_HOURS) continue;
    data.push({
      date: r.date,
      bedDate: localDatePart(startDt),
      wakeDate: localDatePart(endDt),
      bed: Math.max(0, Math.min(bed, CHART_HOURS)),
      wake: Math.max(0, Math.min(wake, CHART_HOURS)),
      duration: (endDt.getTime() - startDt.getTime()) / 3_600_000,
      bedClock: formatClock(bed),
      wakeClock: formatClock(rawWake),
    });
  }

  if (data.length < 3) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
            Sleep schedule
          </div>
        </div>
        <div className="empty-state">
          <div className="title">Not enough timestamped sleep yet</div>
          <div className="sub">Run scripts/backfill_sleep_local_times.py or wait for next sync</div>
        </div>
      </div>
    );
  }

  const avgBed = data.reduce((a, d) => a + d.bed, 0) / data.length;
  const avgWake = data.reduce((a, d) => a + d.wake, 0) / data.length;
  const minBed = Math.min(...data.map((d) => d.bed));
  const maxBed = Math.max(...data.map((d) => d.bed));
  const minWake = Math.min(...data.map((d) => d.wake));
  const maxWake = Math.max(...data.map((d) => d.wake));

  const chartData = data.map((d) => ({
    ...d,
    spacer: d.bed,
    window: Math.max(0.05, d.wake - d.bed),
  }));

  const subtitle = `Bedtime ${formatClock(minBed)} → ${formatClock(maxBed)} · Wake ${formatClock(minWake)} → ${formatClock(maxWake)}`;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
            Sleep schedule ({rangeLabel})
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>{subtitle}</div>
        </div>
      </div>
      <div style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            layout="vertical"
            data={chartData}
            margin={{ top: 6, right: 12, left: 0, bottom: 0 }}
            barCategoryGap={2}
          >
            <CartesianGrid stroke="rgba(255,255,255,0.05)" horizontal={false} />
            <XAxis
              type="number"
              domain={[0, CHART_HOURS]}
              ticks={HOUR_TICKS}
              tickFormatter={(v: number) => HOUR_LABELS[v] ?? ""}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="date"
              tickFormatter={formatShortDate}
              tick={{ fill: "var(--fg-3)", fontSize: 10, fontFamily: "var(--font-mono)" }}
              axisLine={false}
              tickLine={false}
              width={56}
              interval={0}
            />
            <ReferenceArea
              x1={Math.max(0, avgBed - 0.5)}
              x2={Math.min(CHART_HOURS, avgBed + 0.5)}
              fill="#00d4aa"
              fillOpacity={0.12}
              stroke="#00d4aa"
              strokeOpacity={0.4}
              strokeDasharray="3 3"
            />
            <ReferenceArea
              x1={Math.max(0, avgWake - 0.5)}
              x2={Math.min(CHART_HOURS, avgWake + 0.5)}
              fill="#00d4aa"
              fillOpacity={0.12}
              stroke="#00d4aa"
              strokeOpacity={0.4}
              strokeDasharray="3 3"
            />
            <Tooltip content={<TimelineTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
            <Bar dataKey="spacer" stackId="s" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="window" stackId="s" radius={[3, 3, 3, 3]} isAnimationActive={false}>
              {chartData.map((d) => {
                const inBand = Math.abs(d.bed - avgBed) <= 0.5 && Math.abs(d.wake - avgWake) <= 0.5;
                return <Cell key={d.date} fill={inBand ? "#7b61ff" : "#00aaff"} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div
        style={{
          display: "flex",
          gap: 16,
          marginTop: 10,
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--fg-3)",
          flexWrap: "wrap",
        }}
      >
        <span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: "#7b61ff",
              borderRadius: 2,
              verticalAlign: "middle",
              marginRight: 4,
            }}
          />
          in band
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: "#00aaff",
              borderRadius: 2,
              verticalAlign: "middle",
              marginRight: 4,
            }}
          />
          off band
        </span>
        <span>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              background: "rgba(0,212,170,0.18)",
              border: "1px dashed rgba(0,212,170,0.5)",
              verticalAlign: "middle",
              marginRight: 4,
            }}
          />
          avg ±30min
        </span>
      </div>
    </div>
  );
}
