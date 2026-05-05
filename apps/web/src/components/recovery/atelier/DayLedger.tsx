import { recoveryZone } from "@/lib/format";
import type { RecoveryRow } from "@/lib/db";

type Props = { rows: RecoveryRow[] };

export default function DayLedger({ rows }: Props) {
  const display = rows.slice().reverse();

  const hrvVals = display.map((r) => r.hrv).filter((v): v is number => v != null);
  const rhrVals = display.map((r) => r.rhr).filter((v): v is number => v != null);
  const hrvMin = hrvVals.length ? Math.min(...hrvVals) : 0;
  const hrvMax = hrvVals.length ? Math.max(...hrvVals) : 1;
  const rhrMin = rhrVals.length ? Math.min(...rhrVals) : 0;
  const rhrMax = rhrVals.length ? Math.max(...rhrVals) : 1;
  const hrvRange = hrvMax - hrvMin || 1;
  const rhrRange = rhrMax - rhrMin || 1;

  function zoneTag(score: number | null) {
    const z = recoveryZone(score);
    if (z === "green") return { label: "GRN", cls: "tag-olive" };
    if (z === "yellow") return { label: "YEL", cls: "tag-mustard" };
    return { label: "RED", cls: "tag-coral" };
  }

  if (display.length === 0) {
    return (
      <div className="atelier-recovery-ledger">
        <div className="atelier-plate-head">
          <span className="atelier-plate-fig">FIG. 06 / DL-30</span>
        </div>
        <p className="atelier-chart-empty">No recovery data</p>
      </div>
    );
  }

  return (
    <div className="atelier-recovery-ledger">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">FIG. 06 / DL-30</span>
        <span className="atelier-plate-page">30-row ledger</span>
      </div>
      <p className="atelier-recovery-chart-title">
        Day ledger, <em>newest first.</em>
      </p>
      <table className="atelier-day-ledger-tbl">
        <thead>
          <tr>
            <th>Date</th>
            <th>Score</th>
            <th>Zone</th>
            <th>HRV</th>
            <th>RHR</th>
          </tr>
        </thead>
        <tbody>
          {display.map((r) => {
            const tag = zoneTag(r.recovery_score);
            const hrvPct = r.hrv != null ? ((r.hrv - hrvMin) / hrvRange) * 100 : 0;
            // RHR inverted: lower = better = longer bar
            const rhrPct = r.rhr != null ? ((rhrMax - r.rhr) / rhrRange) * 100 : 0;
            return (
              <tr key={r.date}>
                <td className="atelier-ledger-date">{r.date}</td>
                <td className="atelier-ledger-score">{r.recovery_score != null ? r.recovery_score : "—"}</td>
                <td>
                  <span className={`atelier-ledger-tag ${tag.cls}`}>{tag.label}</span>
                </td>
                <td className="atelier-ledger-bar-cell">
                  {r.hrv != null && (
                    <div className="atelier-ledger-bar-wrap">
                      <div className="atelier-ledger-bar hrv-bar" style={{ width: `${hrvPct}%` }} />
                      <span className="atelier-ledger-bar-val">{r.hrv.toFixed(0)}</span>
                    </div>
                  )}
                  {r.hrv == null && <span className="atelier-ledger-null">—</span>}
                </td>
                <td className="atelier-ledger-bar-cell">
                  {r.rhr != null && (
                    <div className="atelier-ledger-bar-wrap">
                      <div className="atelier-ledger-bar rhr-bar" style={{ width: `${rhrPct}%` }} />
                      <span className="atelier-ledger-bar-val">{r.rhr.toFixed(0)}</span>
                    </div>
                  )}
                  {r.rhr == null && <span className="atelier-ledger-null">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
