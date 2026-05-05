import { getChatLogs, getRouteLogs, getSyncLogs, type RouteLog } from "@/lib/db";
import StatsRow from "@/components/logs/atelier/StatsRow";
import EventLedger, { type LedgerRow } from "@/components/logs/atelier/EventLedger";
import ChatLogsTable from "./ChatLogsTable";
import CollapsibleCard from "./CollapsibleCard";
import RouteLogsTable from "./RouteLogsTable";
import SyncLogsTable from "./SyncLogsTable";

export const dynamic = "force-dynamic";

function classifyRoute(r: RouteLog): LedgerRow["kind"] {
  if (r.status >= 500) return "Error";
  if (r.route.startsWith("/recovery")) return "Recovery";
  if (r.route.startsWith("/sleep")) return "Sleep";
  return "Page";
}

export default function LogsPage() {
  const logs = getChatLogs(500);
  const syncLogs = getSyncLogs(200);
  const routeLogs = getRouteLogs(200);

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

  const ledger: LedgerRow[] = [
    ...syncLogs.map((s) => ({
      ts: s.started_at,
      kind: (s.status === "error" ? "Error" : "Sync") as LedgerRow["kind"],
      summary: `Sync · ${s.recovery_count ?? 0}r/${s.sleep_count ?? 0}s/${s.workouts_count ?? 0}w`,
      duration_ms: s.duration_ms,
      status: s.status,
      details: s.details,
    })),
    ...routeLogs.map((r) => ({
      ts: r.started_at,
      kind: classifyRoute(r),
      summary: r.route,
      duration_ms: r.duration_ms,
      status: String(r.status),
      details: r.details,
    })),
    ...logs.map((c) => ({
      ts: c.started_at,
      kind: (c.status === "error" ? "Error" : "Chat") as LedgerRow["kind"],
      summary: c.prompt_preview,
      duration_ms: c.duration_ms,
      status: c.status,
      details: c.details,
    })),
  ]
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 200);

  return (
    <>
      <div className="classic-logs" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
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

        <CollapsibleCard title="Chat request log" sub={`${logs.length} entries · most recent first`} defaultOpen={false}>
          {logs.length === 0 ? (
            <div className="empty-state">
              <div className="title">No chat requests yet</div>
              <div className="sub">Send a message in Coach to populate this log</div>
            </div>
          ) : (
            <ChatLogsTable logs={logs} />
          )}
        </CollapsibleCard>

        <CollapsibleCard title="Sync history" sub={`${syncLogs.length} syncs · most recent first`} defaultOpen={false}>
          {syncLogs.length === 0 ? (
            <div className="empty-state">
              <div className="title">No syncs yet</div>
              <div className="sub">Tap the refresh icon in the top bar to pull fresh Whoop data</div>
            </div>
          ) : (
            <SyncLogsTable logs={syncLogs} />
          )}
        </CollapsibleCard>

        <CollapsibleCard title="Page render history" sub={`${routeLogs.length} renders · most recent first`} defaultOpen={false}>
          {routeLogs.length === 0 ? (
            <div className="empty-state">
              <div className="title">No page renders yet</div>
              <div className="sub">Refresh a dashboard page to populate this log</div>
            </div>
          ) : (
            <RouteLogsTable logs={routeLogs} />
          )}
        </CollapsibleCard>
      </div>

      <div className="atelier-logs">
        <div className="atelier-logs-header">
          <h2 className="atelier-logs-headline">Three numbers, quietly watched.</h2>
        </div>
        <StatsRow syncLogs={syncLogs} chatLogs={logs} />
        <EventLedger rows={ledger} />
      </div>
    </>
  );
}
