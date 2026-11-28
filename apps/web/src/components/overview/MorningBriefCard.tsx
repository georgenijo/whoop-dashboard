import FreshnessBanner from "@/components/strain/FreshnessBanner";
import type { BriefTone, MorningBriefView } from "@/lib/analytics/morningBrief";
import { friendlyDate } from "@/lib/analytics/morningBrief";

const TONE_COLOR: Record<BriefTone, string> = {
  good: "var(--zone-green)",
  warn: "var(--zone-yellow)",
  bad: "var(--zone-red)",
  neutral: "var(--fg-3)",
};

/**
 * Overview "Today" brief (MORNING_BRIEF=1). Server-rendered, no client JS:
 * every line is computed by `composeMorningBrief`.
 */
export default function MorningBriefCard({ brief }: { brief: MorningBriefView }) {
  return (
    <section className="card morning-brief" aria-labelledby="morning-brief-title" style={{ marginBottom: 16 }}>
      <div className="card-head">
        <div>
          <div className="card-title" id="morning-brief-title">
            <span className="dot" style={{ background: "var(--metric-recovery)", color: "var(--metric-recovery)" }} />
            Today
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>
            Morning brief · {friendlyDate(brief.today)}
          </div>
        </div>
      </div>

      <FreshnessBanner latestDate={brief.latestDataDate} today={brief.today} />

      <ul
        data-testid="morning-brief-lines"
        style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}
      >
        {brief.lines.map((line) => (
          <li
            key={line.key}
            data-line={line.key}
            data-tone={line.tone}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(86px, max-content) 1fr",
              columnGap: 14,
              alignItems: "baseline",
              fontSize: 13,
              lineHeight: 1.45,
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "var(--font-mono)",
                fontSize: 10.5,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--fg-3)",
              }}
            >
              <span
                aria-hidden
                style={{ width: 6, height: 6, borderRadius: 999, background: TONE_COLOR[line.tone], flex: "none" }}
              />
              {line.label}
            </span>
            <span style={{ color: line.key === "suggestion" ? "var(--fg-0)" : "var(--fg-1)" }}>
              {line.text}
              {line.note ? (
                <span style={{ display: "block", fontSize: 11.5, color: "var(--fg-3)", marginTop: 2 }}>
                  {line.note}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
