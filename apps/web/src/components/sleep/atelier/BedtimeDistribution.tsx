import type { SleepRow } from "@/lib/db";

type Props = { rows: SleepRow[] };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseHour(iso: string | null): number | null {
  if (!iso) return null;
  const t = iso.split("T")[1] ?? iso;
  const [hStr, mStr] = t.split(":");
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr ?? "0", 10);
  if (Number.isNaN(h)) return null;
  return h + m / 60;
}

function fmtHour(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h % 1) * 60);
  const ampm = hh >= 12 ? "pm" : "am";
  const display = hh % 12 || 12;
  return `${display}:${mm.toString().padStart(2, "0")}${ampm}`;
}

export default function BedtimeDistribution({ rows }: Props) {
  // group by ISO weekday (1=Mon, 7=Sun)
  const byDay: Record<number, { beds: number[]; wakes: number[] }> = {};
  for (let d = 1; d <= 7; d++) byDay[d] = { beds: [], wakes: [] };

  for (const r of rows) {
    if (!r.start_local) continue;
    const date = new Date(r.start_local.split("T")[0] + "T00:00:00");
    const dow = date.getDay(); // 0=Sun
    const isoDay = dow === 0 ? 7 : dow;
    const bed = parseHour(r.start_local);
    const wake = parseHour(r.end_local);
    if (bed != null) byDay[isoDay].beds.push(bed);
    if (wake != null) byDay[isoDay].wakes.push(wake);
  }

  const tableRows = DAYS.map((label, i) => {
    const day = byDay[i + 1];
    const avgBed = day.beds.length
      ? day.beds.reduce((a, b) => a + b, 0) / day.beds.length
      : null;
    const avgWake = day.wakes.length
      ? day.wakes.reduce((a, b) => a + b, 0) / day.wakes.length
      : null;
    return { label, avgBed, avgWake, n: day.beds.length };
  });

  return (
    <div className="atelier-bedtime-table">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">TAB. 01 / SL-26</span>
        <span className="atelier-plate-page">avg bedtime · wake by day</span>
      </div>
      <table className="atelier-bedtime-tbl">
        <thead>
          <tr>
            <th>Day</th>
            <th>Avg Bedtime</th>
            <th>Avg Wake</th>
            <th>n</th>
          </tr>
        </thead>
        <tbody>
          {tableRows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{r.avgBed != null ? fmtHour(r.avgBed) : "—"}</td>
              <td>{r.avgWake != null ? fmtHour(r.avgWake) : "—"}</td>
              <td>{r.n > 0 ? r.n : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
