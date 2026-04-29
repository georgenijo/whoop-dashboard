import { getWorkouts } from "@/lib/db";

export const dynamic = "force-dynamic";

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function WorkoutsPage() {
  const workouts = getWorkouts(50);

  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <div className="card-head">
        <div className="card-title">
          <span className="dot" style={{ background: "#ffaa00", color: "#ffaa00" }} />
          Recent workouts
        </div>
        <span className="card-sub">{workouts.length} sessions</span>
      </div>
      {workouts.length === 0 ? (
        <div className="empty-state">
          <div className="title">No workouts yet</div>
          <div className="sub">Sync Whoop to see workout history</div>
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              {["Date", "Sport", "Duration", "Strain", "Avg HR", "Max HR", "kcal"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "6px 10px", color: "var(--fg-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.1em", fontSize: 10 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {workouts.map((w) => (
              <tr key={w.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.03)" }}>
                <td style={{ padding: "8px 10px", color: "var(--fg-2)" }}>{formatDate(w.date)}</td>
                <td style={{ padding: "8px 10px", color: "var(--fg-0)", fontWeight: 500, fontFamily: "var(--font-sans)" }}>{w.sport ?? "—"}</td>
                <td style={{ padding: "8px 10px", color: "var(--fg-1)" }}>{formatDuration(w.duration_sec)}</td>
                <td style={{ padding: "8px 10px", color: "#ffaa00", fontWeight: 600 }}>{w.strain?.toFixed(1) ?? "—"}</td>
                <td style={{ padding: "8px 10px", color: "var(--fg-1)" }}>{w.avg_hr != null ? `${w.avg_hr} bpm` : "—"}</td>
                <td style={{ padding: "8px 10px", color: "var(--fg-1)" }}>{w.max_hr != null ? `${w.max_hr} bpm` : "—"}</td>
                <td style={{ padding: "8px 10px", color: "var(--fg-2)" }}>{w.kilojoule != null ? `${(w.kilojoule * 0.239).toFixed(0)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
