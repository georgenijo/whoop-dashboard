import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getChatLogs, getChatThreadInfo, getRouteLogs, getSyncLogs } from "@/lib/db";
import { requireAuthOrSignin } from "@/lib/auth";
import ChatLogsByThread from "./ChatLogsByThread";
import CollapsibleCard from "./CollapsibleCard";
import RouteLogsTable from "./RouteLogsTable";
import SyncLogsTable from "./SyncLogsTable";

function deriveThreadIdFromDetails(details?: string | null): number | null {
  if (!details) return null;
  try {
    const parsed = JSON.parse(details) as { thread_id?: unknown };
    return typeof parsed?.thread_id === "number" ? parsed.thread_id : null;
  } catch {
    return null;
  }
}

export const dynamic = "force-dynamic";

export default async function LogsPage() {
  const headerList = await headers();
  const { user } = await requireAuthOrSignin(
    new Request("http://localhost", { headers: headerList }),
  );

  // chat_logs is cross-user (details holds full prompts + raw health rows for
  // every tenant, not just the signed-in one) — same admin gate as the
  // /api/logs JSON route (#491). Per-user scoping of the underlying queries
  // is separate work (#494); this just keeps the page's exposure consistent
  // with the API's until that lands.
  const adminSub = process.env.ADMIN_APPLE_SUB;
  if (!adminSub || user.apple_sub !== adminSub) {
    notFound();
  }

  const logs = getChatLogs(500);
  const syncLogs = getSyncLogs(200);
  const routeLogs = getRouteLogs(200);

  // Resolve thread metadata for grouping. Pull thread_id from the column when
  // present, fall back to the legacy details JSON for older rows.
  const threadIdSet = new Set<number>();
  for (const log of logs) {
    const tid = log.thread_id ?? deriveThreadIdFromDetails(log.details);
    if (tid != null) threadIdSet.add(tid);
  }
  const threadInfoMap = getChatThreadInfo(Array.from(threadIdSet));
  const threadsObj: Record<string, { id: number; title: string | null; first_user_message: string | null }> = {};
  for (const [id, info] of threadInfoMap) {
    threadsObj[String(id)] = info;
  }
  const distinctThreads = threadIdSet.size;

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

      <CollapsibleCard
        title="Chat by thread"
        sub={`${distinctThreads} thread${distinctThreads === 1 ? "" : "s"} · ${logs.length} call${logs.length === 1 ? "" : "s"}`}
        defaultOpen={false}
      >
        {logs.length === 0 ? (
          <div className="empty-state">
            <div className="title">No chat requests yet</div>
            <div className="sub">Send a message in Coach to populate this log</div>
          </div>
        ) : (
          <ChatLogsByThread logs={logs} threads={threadsObj} />
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
  );
}
