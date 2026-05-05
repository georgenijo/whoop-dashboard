"use client";

import { useState, useMemo } from "react";
import type { WorkoutRow } from "@/lib/db";
import { sportColor } from "@/lib/sport-color";

type Props = { rows: WorkoutRow[] };

const ROMAN = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII","XIII","XIV","XV","XVI","XVII","XVIII","XIX","XX","XXI","XXII","XXIII","XXIV","XXV","XXVI","XXVII","XXVIII"];

function toRoman(n: number): string {
  return ROMAN[n] ?? String(n + 1);
}

function fmtDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function fmtDur(sec: number | null): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function Logbook({ rows }: Props) {
  const [sport, setSport] = useState<string>("All");

  const sports = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const key = r.sport ?? "Other";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    return [["All", rows.length] as [string, number], ...sorted];
  }, [rows]);

  const filtered = sport === "All" ? rows : rows.filter((r) => (r.sport ?? "Other") === sport);
  const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="atelier-logbook">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">II. Logbook / Plate N&#xba; 02</span>
        <span className="atelier-plate-page">002 / 003</span>
      </div>

      <div className="atelier-logbook-pills">
        {sports.map(([s, count]) => (
          <button
            key={s}
            className={`atelier-logbook-pill${sport === s ? " active" : ""}`}
            onClick={() => setSport(s)}
          >
            {s} <span className="atelier-logbook-pill-count">{count}</span>
          </button>
        ))}
      </div>

      {sorted.length === 0 ? (
        <div className="atelier-logbook-empty">No workouts in this window.</div>
      ) : (
        <table className="atelier-logbook-tbl">
          <thead>
            <tr>
              {["#", "Date", "Sport", "Duration", "Strain", "Avg HR", "Max HR", "kcal"].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((w, i) => (
              <tr key={w.id}>
                <td className="atelier-logbook-roman">{toRoman(i)}</td>
                <td>{fmtDate(w.date)}</td>
                <td>
                  <span
                    className="atelier-logbook-sport-tag"
                    style={{ borderColor: sportColor(w.sport), color: sportColor(w.sport) }}
                  >
                    {w.sport ?? "Other"}
                  </span>
                </td>
                <td>{fmtDur(w.duration_sec)}</td>
                <td className="atelier-logbook-strain">{w.strain?.toFixed(1) ?? "—"}</td>
                <td>{w.avg_hr != null ? `${w.avg_hr}` : "—"}</td>
                <td>{w.max_hr != null ? `${w.max_hr}` : "—"}</td>
                <td>{w.kilojoule != null ? `${(w.kilojoule * 0.239).toFixed(0)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
