"use client";

import { useState } from "react";
import type { NapRow } from "@/lib/db";

type Props = { naps: NapRow[]; rangeLabel: string };

function formatHM(ms: number): string {
  const total = Math.round(ms / 60_000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function asleepMs(n: NapRow): number {
  return (n.light_ms ?? 0) + (n.deep_ms ?? 0) + (n.rem_ms ?? 0);
}

function parseLocalParts(iso: string | null): { date: Date; minutes: number } | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const minutes = Number(m[4]) * 60 + Number(m[5]);
  return { date, minutes };
}

function formatWeekday(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function formatMonthDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const TEAL = "#00d4aa";
const TEAL_DIM = "rgba(0,212,170,0.18)";
const LIGHT_C = "#5b8def";
const DEEP_C = "#7b61ff";
const REM_C = "#00d4aa";
const AWAKE_C = "rgba(255,255,255,0.18)";

export default function NapsList({ naps, rangeLabel }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = [...naps].sort((a, b) => (a.date < b.date ? 1 : -1));
  const count = sorted.length;
  const totalMs = sorted.reduce((s, n) => s + asleepMs(n), 0);
  const avgMs = count > 0 ? totalMs / count : 0;
  const longestMs = sorted.reduce((m, n) => Math.max(m, asleepMs(n)), 0);

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: TEAL, color: TEAL }} />
            Nap stages
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>{rangeLabel}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 16 }}>
        <KPI label="Naps in range" value={`${count}`} />
        <KPI label="Avg duration" value={count > 0 ? formatHM(avgMs) : "—"} />
        <KPI label="Total nap credit" value={count > 0 ? formatHM(totalMs) : "—"} />
      </div>

      {count === 0 ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--fg-3)",
            padding: "24px 8px",
            textAlign: "center",
          }}
        >
          No naps in this range
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sorted.map((n) => {
            const ms = asleepMs(n);
            const isExpanded = expanded === n.date;
            const isLongest = ms === longestMs && count > 1;
            return (
              <NapRowView
                key={n.date}
                nap={n}
                ms={ms}
                isExpanded={isExpanded}
                isLongest={isLongest}
                onToggle={() => setExpanded(isExpanded ? null : n.date)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function NapRowView({
  nap,
  ms,
  isExpanded,
  isLongest,
  onToggle,
}: {
  nap: NapRow;
  ms: number;
  isExpanded: boolean;
  isLongest: boolean;
  onToggle: () => void;
}) {
  const start = parseLocalParts(nap.start_local);
  const end = parseLocalParts(nap.end_local);
  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 8,
        background: "rgba(255,255,255,0.015)",
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: "10px 12px",
          cursor: "pointer",
          textAlign: "left",
          display: "grid",
          gridTemplateColumns: "auto auto 1fr auto auto",
          alignItems: "center",
          gap: 12,
          color: "inherit",
        }}
        aria-expanded={isExpanded}
      >
        <div style={{ display: "flex", flexDirection: "column", minWidth: 64 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.08em",
              color: "var(--fg-3)",
              textTransform: "uppercase",
            }}
          >
            {formatWeekday(nap.date)}
          </span>
          <span
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 13,
              color: "var(--fg-1)",
              letterSpacing: "-0.01em",
            }}
          >
            {formatMonthDay(nap.date)}
          </span>
        </div>

        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 16,
            color: "var(--fg-0)",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-0.02em",
            minWidth: 64,
          }}
        >
          {formatHM(ms)}
        </div>

        <TimeOfDayRibbon startMin={start?.minutes ?? null} endMin={end?.minutes ?? null} />

        {isLongest ? (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: TEAL,
              padding: "2px 6px",
              border: `1px solid ${TEAL_DIM}`,
              borderRadius: 4,
              background: "rgba(0,212,170,0.06)",
            }}
          >
            Longest
          </span>
        ) : (
          <span />
        )}

        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--fg-3)",
            transition: "transform 0.18s ease",
            transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
            display: "inline-block",
            width: 12,
            textAlign: "center",
          }}
          aria-hidden
        >
          ▸
        </span>
      </button>

      {isExpanded && <StageBreakdown nap={nap} />}
    </div>
  );
}

function TimeOfDayRibbon({
  startMin,
  endMin,
}: {
  startMin: number | null;
  endMin: number | null;
}) {
  const valid = startMin !== null && endMin !== null && endMin > startMin;
  return (
    <div style={{ position: "relative", height: 22, width: "100%" }}>
      <div
        style={{
          position: "absolute",
          inset: "10px 0",
          background: "rgba(255,255,255,0.04)",
          borderRadius: 2,
        }}
      />
      {[0, 6, 12, 18, 24].map((h) => (
        <div
          key={h}
          style={{
            position: "absolute",
            left: `${(h / 24) * 100}%`,
            top: 4,
            bottom: 4,
            width: 1,
            background: "rgba(255,255,255,0.08)",
          }}
        />
      ))}
      {valid && (
        <div
          style={{
            position: "absolute",
            top: 6,
            bottom: 6,
            left: `${((startMin as number) / 1440) * 100}%`,
            width: `${(((endMin as number) - (startMin as number)) / 1440) * 100}%`,
            background: `linear-gradient(180deg, ${TEAL} 0%, rgba(0,212,170,0.7) 100%)`,
            borderRadius: 3,
            boxShadow: "0 0 8px rgba(0,212,170,0.45)",
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: -2,
          fontFamily: "var(--font-mono)",
          fontSize: 8,
          color: "var(--fg-3)",
          opacity: 0.5,
        }}
      >
        12a
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: -2,
          transform: "translateX(-50%)",
          fontFamily: "var(--font-mono)",
          fontSize: 8,
          color: "var(--fg-3)",
          opacity: 0.5,
        }}
      >
        12p
      </div>
      <div
        style={{
          position: "absolute",
          right: 0,
          top: -2,
          fontFamily: "var(--font-mono)",
          fontSize: 8,
          color: "var(--fg-3)",
          opacity: 0.5,
        }}
      >
        12a
      </div>
    </div>
  );
}

function StageBreakdown({ nap }: { nap: NapRow }) {
  const light = nap.light_ms ?? 0;
  const deep = nap.deep_ms ?? 0;
  const rem = nap.rem_ms ?? 0;
  const awake = nap.awake_ms ?? 0;
  const total = light + deep + rem + awake;
  const segs = [
    { label: "Light", ms: light, color: LIGHT_C },
    { label: "Deep", ms: deep, color: DEEP_C },
    { label: "REM", ms: rem, color: REM_C },
    { label: "Awake", ms: awake, color: AWAKE_C },
  ];

  return (
    <div
      style={{
        padding: "0 12px 12px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        borderTop: "1px solid rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginTop: 10 }}>
        {segs.map((s) => (
          <div
            key={s.label}
            style={{
              width: total > 0 ? `${(s.ms / total) * 100}%` : 0,
              background: s.color,
            }}
            title={`${s.label}: ${formatHM(s.ms)}`}
          />
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 8,
          fontFamily: "var(--font-mono)",
          fontSize: 10.5,
        }}
      >
        {segs.map((s) => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: s.color,
                flexShrink: 0,
              }}
            />
            <span style={{ color: "var(--fg-2)" }}>{s.label}</span>
            <span style={{ color: "var(--fg-0)", marginLeft: "auto", fontVariantNumeric: "tabular-nums" }}>
              {formatHM(s.ms)}
            </span>
          </div>
        ))}
      </div>
      {nap.performance != null && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--fg-3)",
            display: "flex",
            gap: 16,
            paddingTop: 4,
          }}
        >
          <span>Performance {Math.round(nap.performance)}%</span>
          {nap.efficiency != null && <span>Efficiency {Math.round(nap.efficiency)}%</span>}
        </div>
      )}
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)" }}>{label}</span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          color: "var(--fg-1)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </span>
    </div>
  );
}
