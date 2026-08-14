import DOMPurify from "isomorphic-dompurify";
import { marked } from "marked";
import Link from "next/link";
import type { InsightRow } from "@/lib/db";

function formatInsightDate(date: string): string {
  const todayStr = new Date().toLocaleDateString("en-CA");
  const diff = Math.round(
    (new Date(todayStr).getTime() - new Date(date).getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  return `${diff}d ago`;
}

export default function AIInsightCard({
  hasData,
  insight,
  refreshing,
}: {
  hasData: boolean;
  insight: InsightRow | null;
  refreshing: boolean;
}) {
  return (
    <div className="ai-card" aria-label="AI insight">
      <div className="ai-head">
        <span className="ai-tag">Coach</span>
        {refreshing ? <span className="ai-refreshing">Refreshing...</span> : null}
        <span className="ai-when">
          {insight ? formatInsightDate(insight.date) : hasData ? "Not yet generated" : "No data"}
        </span>
      </div>
      {insight ? (
        <>
          <div
            className="ai-body"
            dangerouslySetInnerHTML={{
              __html: DOMPurify.sanitize(marked.parse(insight.insight) as string),
            }}
          />
          <div className="ai-byline">
            <span>Generated from your recent data</span>
            <Link href="/coach">Ask a follow-up</Link>
          </div>
        </>
      ) : hasData ? (
        <>
          <p>{refreshing ? "Generating your latest insight..." : "No insight generated yet."}</p>
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
