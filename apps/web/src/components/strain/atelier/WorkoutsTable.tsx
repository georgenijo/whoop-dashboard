import type { WorkoutRow } from "@/lib/db";

type Props = { rows: WorkoutRow[] };

const ROMANS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
                "XI", "XII", "XIII", "XIV", "XV"];

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m}m`;
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtKcal(kj: number | null): string {
  if (kj == null) return "—";
  return Math.round(kj / 4.184).toLocaleString();
}

export default function WorkoutsTable({ rows }: Props) {
  return (
    <div className="atelier-strain-log">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">Plate N&#xba; 05 / FIG. 30-D-LOG</span>
        <span className="atelier-plate-page">recent sessions</span>
      </div>
      {rows.length === 0 ? (
        <p className="atelier-chart-empty">No workout data</p>
      ) : (
        <table className="atelier-strain-log-tbl">
          <thead>
            <tr>
              <th></th>
              <th>Date</th>
              <th>Sport</th>
              <th>Duration</th>
              <th>Strain</th>
              <th>Avg HR</th>
              <th>Max HR</th>
              <th>kcal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.id}>
                <td className="atelier-strain-log-roman">{ROMANS[i] ?? i + 1}</td>
                <td>{fmtDate(row.date)}</td>
                <td>{row.sport ?? "—"}</td>
                <td>{fmtDuration(row.duration_sec)}</td>
                <td>{row.strain != null ? row.strain.toFixed(1) : "—"}</td>
                <td>{row.avg_hr != null ? `${row.avg_hr}` : "—"}</td>
                <td>{row.max_hr != null ? `${row.max_hr}` : "—"}</td>
                <td>{fmtKcal(row.kilojoule)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
