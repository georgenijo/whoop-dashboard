import { marked } from "marked";
import { getLatestInsight } from "@/lib/db";

function formatInsightDate(date: string): string {
  const todayStr = new Date().toLocaleDateString("en-CA");
  const diff = Math.round(
    (new Date(todayStr).getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return `${diff}d ago`;
}

export default function AIInsightCard({ hasData }: { hasData: boolean }) {
  const insight = getLatestInsight();

  return (
    <div className="ai-card" aria-label="AI insight">
      <div className="ai-head">
        <div className="ai-dot" aria-hidden />
        <span className="ai-tag">AI Insight</span>
        <span className="ai-when">
          {insight ? formatInsightDate(insight.date) : hasData ? "Not yet generated" : "No data"}
        </span>
      </div>
      {insight ? (
        <div
          className="ai-body"
          dangerouslySetInnerHTML={{ __html: marked.parse(insight.insight) as string }}
        />
      ) : hasData ? (
        <>
          <p>No insight generated yet for today.</p>
          <p style={{ marginTop: 8, color: "var(--fg-3)", fontSize: 12 }}>
            Run <code style={{ background: "rgba(123,97,255,0.12)", padding: "1px 6px", borderRadius: 4 }}>python sync/daily_sync.py</code> from the repo root to generate one.
          </p>
        </>
      ) : (
        <>
          <p>Connect Whoop to unlock AI-generated insights about your recovery, sleep, and strain.</p>
          <a
            href="/api/auth/login"
            className="empty-state"
            style={{ textDecoration: "none", border: "none", display: "inline-block", marginTop: 8 }}
          >
            <span className="cta">Connect Whoop →</span>
          </a>
        </>
      )}
    </div>
  );
}
