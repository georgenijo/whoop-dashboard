import Link from "next/link";
import type { RecoveryRow, SleepRow, CycleRow, InsightRow } from "@/lib/db";

// ─── helpers ────────────────────────────────────────────────────────────────

function extractFirstSentence(markdown: string): string {
  const plain = markdown
    .replace(/#{1,6}\s.+/g, "")
    .replace(/[*_`]/g, "")
    .trim();
  const sentence = plain.match(/[^.!?]+[.!?]/)?.[0]?.trim();
  return sentence ?? plain.slice(0, 200);
}

function stressLabel(score: number | null): {
  text: "Low" | "Moderate" | "High";
} {
  if (score == null) return { text: "Low" };
  if (score >= 67) return { text: "Low" };
  if (score >= 34) return { text: "Moderate" };
  return { text: "High" };
}

// ─── main component ──────────────────────────────────────────────────────────

type Props = {
  latestRecovery: RecoveryRow | null;
  latestCycle: CycleRow | null;
  latestSleep: SleepRow | null;
  insight: InsightRow | null;
  /** body_weight_kg for hydration estimate (optional; defaults 70kg) */
  bodyWeightKg?: number;
};

export default function AtelierBottomStrip({
  latestRecovery,
  latestCycle,
  latestSleep,
  insight,
  bodyWeightKg,
}: Props) {
  // ── Stress ──
  const score = latestRecovery?.recovery_score ?? null;
  const { text: stressText } = stressLabel(score);
  const avgHr = latestCycle?.avg_hr ?? null;

  // ── Hydration ──
  const hydrationL =
    bodyWeightKg != null ? Math.round(bodyWeightKg * 0.033 * 10) / 10 : null;
  const goalL = 2.6;

  // ── Coach digest ──
  const firstSentence = insight
    ? extractFirstSentence(insight.insight)
    : "No coach insight yet — sync your Whoop to generate today's analysis.";

  const toolCount = 4; // fixed display; adjust if dynamic count becomes available

  return (
    <div className="atelier-bottom-strip">
      {/* ── Col 1: Stress today ── */}
      <div className="atelier-strip-col">
        <span className="atelier-strip-eyebrow">STRESS TODAY</span>
        <p className="atelier-strip-big-serif">{stressText}</p>
        <p className="atelier-strip-meta">
          {avgHr != null ? `Avg HR ${avgHr} · band 4` : "No HR data"}
        </p>
        <span className="atelier-strip-delta atelier-strip-delta--flat">
          stable
        </span>
      </div>

      {/* ── Col 2: Hydration ── */}
      <div className="atelier-strip-col">
        <span className="atelier-strip-eyebrow">HYDRATION · EST.</span>
        <p className="atelier-strip-big-num">
          {hydrationL != null ? (
            <>{hydrationL.toFixed(1)}<span className="atelier-strip-big-unit"> L</span></>
          ) : "—"}
        </p>
        <p className="atelier-strip-meta">{hydrationL != null ? `Goal ${goalL.toFixed(1)} L` : "No body data"}</p>
        <span className="atelier-strip-delta atelier-strip-delta--flat">
          estimate
        </span>
      </div>

      {/* ── Col 3: Coach digest ── */}
      <div className="atelier-strip-col">
        <span className="atelier-strip-eyebrow">COACH DIGEST</span>
        <p className="atelier-strip-coach-sentence">{firstSentence}</p>
        <div className="atelier-strip-coach-footer">
          <span className="atelier-strip-meta">
            Sonnet 4.6 · {toolCount} tools
          </span>
          <Link href="/coach" className="atelier-strip-coach-link">
            read full ↗
          </Link>
        </div>
      </div>
    </div>
  );
}
