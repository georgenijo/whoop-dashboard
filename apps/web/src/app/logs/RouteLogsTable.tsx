type RouteLogRow = {
  id: number;
  started_at: string;
  route: string;
  duration_ms: number;
  status: number;
};

function fmtDuration(ms: number): { text: string; color: string } {
  const s = ms / 1000;
  let color = "var(--fg-2)";
  if (s < 5) color = "#00d4aa";
  else if (s < 15) color = "#ffaa00";
  else color = "#ff6b6b";
  return { text: s < 1 ? `${ms}ms` : `${s.toFixed(1)}s`, color };
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

function statusColor(status: number): { background: string; color: string } {
  if (status >= 200 && status < 400) {
    return { background: "rgba(0,212,170,0.15)", color: "#00d4aa" };
  }
  if (status >= 400 && status < 500) {
    return { background: "rgba(255,170,0,0.15)", color: "#ffaa00" };
  }
  return { background: "rgba(255,107,107,0.15)", color: "#ff6b6b" };
}

function LogRow({ log }: { log: RouteLogRow }) {
  const dur = fmtDuration(log.duration_ms);
  const status = statusColor(log.status);

  return (
    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
      <td style={{ padding: "10px 16px", color: "var(--fg-2)", fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "nowrap" }}>
        {fmtTime(log.started_at)}
      </td>
      <td style={{ padding: "10px 16px", color: "var(--fg-1)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
        {log.route}
      </td>
      <td style={{ padding: "10px 16px", textAlign: "right", color: dur.color, fontFamily: "var(--font-mono)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
        {dur.text}
      </td>
      <td style={{ padding: "10px 16px", textAlign: "center" }}>
        <span style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 4,
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          background: status.background,
          color: status.color,
        }}>
          {log.status}
        </span>
      </td>
    </tr>
  );
}

export default function RouteLogsTable({ logs }: { logs: RouteLogRow[] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-sans)", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
            <th style={{ padding: "10px 16px", textAlign: "left", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Time</th>
            <th style={{ padding: "10px 16px", textAlign: "left", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Route</th>
            <th style={{ padding: "10px 16px", textAlign: "right", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Duration</th>
            <th style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", fontWeight: 500 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <LogRow key={log.id} log={log} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
