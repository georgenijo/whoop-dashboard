import { getChatLogs, getSyncLogs } from "@/lib/db";
import ChatLogsTable from "./ChatLogsTable";
import SyncLogsTable from "./SyncLogsTable";

export const dynamic = "force-dynamic";

export default function LogsPage() {
  const logs = getChatLogs(500);
  const syncLogs = getSyncLogs(200);

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
          <ChatLogsTable logs={logs} />
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="card-head" style={{ padding: "16px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
          <div className="card-title">Sync history</div>
          <span className="card-sub">{syncLogs.length} syncs · most recent first</span>
        </div>

        {syncLogs.length === 0 ? (
          <div className="empty-state">
            <div className="title">No syncs yet</div>
            <div className="sub">Tap the refresh icon in the top bar to pull fresh Whoop data</div>
          </div>
        ) : (
          <SyncLogsTable logs={syncLogs} />
        )}
      </div>
    </div>
  );
}
