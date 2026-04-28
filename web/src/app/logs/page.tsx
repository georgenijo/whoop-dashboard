import { getChatLogs } from "@/lib/db";

export const dynamic = "force-dynamic";

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
    timeZone: "America/New_York",
  }) + " EST";
}

export default function LogsPage() {
  const logs = getChatLogs(500);

  const okLogs = logs.filter((l) => l.status === "ok");
  const avgDur = okLogs.length
    ? okLogs.reduce((a, b) => a + b.duration_ms, 0) / okLogs.length
    : 0;
  const p50 = okLogs.length
    ? [...okLogs].map((l) => l.duration_ms).sort((a, b) => a - b)[
        Math.floor(okLogs.length / 2)
      ]
    : 0;
  const p95 = okLogs.length
    ? [...okLogs].map((l) => l.duration_ms).sort((a, b) => a - b)[
        Math.floor(okLogs.length * 0.95)
      ]
    : 0;
  const errorRate = logs.length
    ? (logs.filter((l) => l.status !== "ok").length / logs.length) * 100
    : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="kpi-strip" aria-label="Chat metrics" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="kpi" style={{ cursor: "default" }}>
          <div className="head">
            <span className="lbl">Total requests</span>
            <span className="dot" style={{ background: "#7b61ff", color: "#7b61ff" }} />
          </div>
          <div className="val">{logs.length}</div>
          <div className="delta flat">{logs.filter((l) => l.status !== "ok").length} errors</div>
        </div>
        <div className="kpi" style={{ cursor: "default" }}>
          <div className="head">
            <span className="lbl">Avg duration</span>
            <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
          </div>
          <div className="val">
            {(avgDur / 1000).toFixed(1)}<span className="unit">s</span>
          </div>
          <div className="delta flat">across {okLogs.length} ok</div>
        </div>
        <div className="kpi" style={{ cursor: "default" }}>
          <div className="head">
            <span className="lbl">p50 / p95</span>
            <span className="dot" style={{ background: "#ffaa00", color: "#ffaa00" }} />
          </div>
          <div className="val">
            {(p50 / 1000).toFixed(1)}<span className="unit">s</span>
          </div>
          <div className="delta flat">p95 {(p95 / 1000).toFixed(1)}s</div>
        </div>
        <div className="kpi" style={{ cursor: "default" }}>
          <div className="head">
            <span className="lbl">Error rate</span>
            <span className="dot" style={{ background: "#ff6b6b", color: "#ff6b6b" }} />
          </div>
          <div className="val">
            {errorRate.toFixed(1)}<span className="unit">%</span>
          </div>
          <div className="delta flat">last {logs.length} req</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="card-head" style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="card-title">Chat request log</div>
          <span className="card-sub">{logs.length} entries · most recent first</span>
        </div>

        {logs.length === 0 ? (
          <div className="empty-state">
            <div className="title">No chat requests yet</div>
            <div className="sub">Send a message in Coach to populate this log</div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-sans)", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <th style={{ padding: "10px 16px", textAlign: "left", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Time</th>
                  <th style={{ padding: "10px 16px", textAlign: "left", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Prompt</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Duration</th>
                  <th style={{ padding: "10px 16px", textAlign: "right", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Resp</th>
                  <th style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Type</th>
                  <th style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Range</th>
                  <th style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 500 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const dur = fmtDuration(log.duration_ms);
                  return (
                    <tr key={log.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ padding: "10px 16px", color: "var(--fg-2)", fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "nowrap" }}>
                        {fmtTime(log.started_at)}
                      </td>
                      <td style={{ padding: "10px 16px", color: "var(--fg-1)", maxWidth: 480, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {log.prompt_preview}
                      </td>
                      <td style={{ padding: "10px 16px", textAlign: "right", color: dur.color, fontFamily: "var(--font-mono)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                        {dur.text}
                      </td>
                      <td style={{ padding: "10px 16px", textAlign: "right", color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
                        {log.response_length > 0 ? `${log.response_length}` : "—"}
                      </td>
                      <td style={{ padding: "10px 16px", textAlign: "center" }}>
                        {log.type ? (
                          <span style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontFamily: "var(--font-mono)",
                            background: log.type === "api" ? "rgba(123,97,255,0.15)" : "rgba(255,255,255,0.06)",
                            color: log.type === "api" ? "#a08aff" : "var(--fg-2)",
                            textTransform: "uppercase",
                          }}>
                            {log.type}
                          </span>
                        ) : (
                          <span style={{ color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 12 }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: "10px 16px", textAlign: "center", color: "var(--fg-3)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {log.days_context && log.days_context < 9999 ? `${log.days_context}d` : "all"}
                      </td>
                      <td style={{ padding: "10px 16px", textAlign: "center" }}>
                        <span style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          background: log.status === "ok" ? "rgba(0,212,170,0.15)" : "rgba(255,107,107,0.15)",
                          color: log.status === "ok" ? "#00d4aa" : "#ff6b6b",
                        }}>
                          {log.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
