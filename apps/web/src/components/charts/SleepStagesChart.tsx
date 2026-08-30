import type { SleepRow } from "@/lib/db";
import { msToHoursNumber } from "@/lib/format";

type Props = { rows: SleepRow[] };

const STAGES = [
  { key: "deep_ms" as const, label: "Deep", color: "#0055ff" },
  { key: "rem_ms" as const, label: "REM", color: "#7b61ff" },
  { key: "light_ms" as const, label: "Light", color: "#00d4aa" },
  { key: "awake_ms" as const, label: "Awake", color: "#3f3f46" },
];

export default function SleepStagesChart({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <div className="card">
        <div className="card-head">
          <div className="card-title">
            <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
            Sleep stages
          </div>
        </div>
        <div className="empty-state">
          <div className="title">No sleep data yet</div>
          <div className="sub">Sync Whoop to see stage breakdown</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
            Sleep stages
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>{rows.length} nights</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          {STAGES.map((s) => (
            <span key={s.key} style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.color, display: "inline-block" }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {rows.map((r) => {
          const total = (r.deep_ms ?? 0) + (r.rem_ms ?? 0) + (r.light_ms ?? 0) + (r.awake_ms ?? 0);
          if (total === 0) return null;
          const label = new Date(r.date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
          return (
            <div key={r.date} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)", width: 46, flexShrink: 0 }}>{label}</span>
              <div style={{ flex: 1, height: 14, borderRadius: 4, overflow: "hidden", display: "flex" }}>
                {STAGES.map((s) => {
                  const pct = ((r[s.key] ?? 0) / total) * 100;
                  if (pct < 0.5) return null;
                  return (
                    <div
                      key={s.key}
                      title={`${s.label}: ${(msToHoursNumber(r[s.key]) ?? 0).toFixed(1)}h`}
                      style={{ width: `${pct}%`, background: s.color, opacity: 0.85 }}
                    />
                  );
                })}
              </div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-2)", width: 32, textAlign: "right", flexShrink: 0 }}>
                {(msToHoursNumber(r.in_bed_ms) ?? 0).toFixed(1)}h
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
