import type { SyncLog, ChatLog } from "@/lib/db/logs";

type Props = {
  syncLogs: SyncLog[];
  chatLogs: ChatLog[];
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

function buildDailySparkline(syncLogs: SyncLog[]): number[] {
  const counts: Record<string, number> = {};
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    counts[d.toISOString().slice(0, 10)] = 0;
  }
  for (const s of syncLogs) {
    const day = s.started_at.slice(0, 10);
    if (day in counts) counts[day]++;
  }
  return Object.values(counts);
}

function DailySyncSparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 1);
  const w = 80;
  const h = 28;
  const step = w / (data.length - 1);
  const points = data
    .map((v, i) => `${i * step},${h - (v / max) * h}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="atelier-spark-svg" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke="var(--ink-mute)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LastSyncSparkline() {
  return (
    <svg viewBox="0 0 80 28" className="atelier-spark-svg" aria-hidden="true">
      <line
        x1="0" y1="14" x2="80" y2="14"
        stroke="var(--ink-faint)"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <circle cx="76" cy="14" r="3" fill="var(--ink-mute)" />
    </svg>
  );
}

function DurationBarSparkline({ durations }: { durations: number[] }) {
  const last15 = durations.slice(-15);
  const max = Math.max(...last15, 1);
  const w = 80;
  const h = 28;
  const barW = Math.floor(w / last15.length) - 1;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="atelier-spark-svg" aria-hidden="true">
      {last15.map((v, i) => {
        const bh = Math.max(2, (v / max) * h);
        return (
          <rect
            key={i}
            x={i * (barW + 1)}
            y={h - bh}
            width={barW}
            height={bh}
            fill="var(--ink-mute)"
            opacity="0.7"
          />
        );
      })}
    </svg>
  );
}

export default function StatsRow({ syncLogs, chatLogs }: Props) {
  const totalSyncs = syncLogs.length;
  const lastSync = syncLogs[0]?.started_at;
  const okChat = chatLogs.filter((c) => c.status === "ok");
  const avgDurMs = okChat.length
    ? okChat.reduce((a, b) => a + b.duration_ms, 0) / okChat.length
    : 0;
  const avgDurSec = (avgDurMs / 1000).toFixed(1);

  const dailyCounts = buildDailySparkline(syncLogs);
  const chatDurations = okChat.map((c) => c.duration_ms);

  return (
    <div className="atelier-stats-row">
      <div className="atelier-stat-card">
        <div className="atelier-stat-roman">01</div>
        <div className="atelier-stat-label">Total syncs</div>
        <div className="atelier-stat-value">{totalSyncs}</div>
        <DailySyncSparkline data={dailyCounts} />
        <div className="atelier-stat-sub">14-day daily count</div>
      </div>

      <div className="atelier-stat-card">
        <div className="atelier-stat-roman">02</div>
        <div className="atelier-stat-label">Last sync</div>
        <div className="atelier-stat-value">
          {lastSync ? timeAgo(lastSync) : "—"}
        </div>
        <LastSyncSparkline />
        <div className="atelier-stat-sub">
          {lastSync ? new Date(lastSync).toLocaleDateString() : "no syncs yet"}
        </div>
      </div>

      <div className="atelier-stat-card">
        <div className="atelier-stat-roman">03</div>
        <div className="atelier-stat-label">Avg duration</div>
        <div className="atelier-stat-value">
          {avgDurMs > 0 ? `${avgDurSec}s` : "—"}
        </div>
        {chatDurations.length > 0 ? (
          <DurationBarSparkline durations={chatDurations} />
        ) : (
          <LastSyncSparkline />
        )}
        <div className="atelier-stat-sub">coach requests · last 15</div>
      </div>
    </div>
  );
}
