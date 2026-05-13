import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  acquireSettingLock,
  getHealthContext,
  getLatestInsight,
  getLatestWhoopDataTimestamp,
  isSettingLockActive,
  releaseSettingLock,
  saveInsight,
  type InsightRow,
  type SettingLock,
} from "@/lib/db";

const INSIGHT_MODEL = "claude-sonnet-4-6";
const INSIGHT_DAYS = 30;
const INSIGHT_LOCK_KEY = "insight_regen_in_flight";
const INSIGHT_LOCK_TTL_MS = 5 * 60 * 1000;

const SYSTEM_PROMPT = `You are a personal health and performance analyst reviewing Whoop biometric data.

Your job:
1. Identify meaningful patterns and trends (not just restate numbers)
2. Flag anomalies or concerning changes
3. Give specific, actionable recommendations
4. Compare recent performance to the user's own baseline (not population averages)
5. Be direct and concise - no fluff

Format your response as:
## Key Findings
- 2-3 most important observations

## Trends
- What's improving, declining, or stable

## Action Items
- 2-3 specific things to do today/this week

## Watch Out
- Anything concerning that needs attention (or "Nothing concerning" if all good)

Keep total response under 300 words.`;

export type InsightStatus = {
  insight: InsightRow | null;
  isStale: boolean;
  isRegenerating: boolean;
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function needsRegeneration(insight: InsightRow | null, latestDataAt: string | null): boolean {
  if (!latestDataAt) return false;
  if (!insight) return true;
  if (insight.date !== todayUtc()) return true;

  const insightCreatedMs = parseTime(insight.created_at);
  const latestDataMs = parseTime(latestDataAt);
  if (insightCreatedMs === null || latestDataMs === null) return true;

  return latestDataMs > insightCreatedMs;
}

export function getInsightStatus(userId: number, hasData: boolean): InsightStatus {
  const insight = getLatestInsight();
  const latestDataAt = hasData ? getLatestWhoopDataTimestamp(userId) : null;
  return {
    insight,
    isStale: hasData && needsRegeneration(insight, latestDataAt),
    isRegenerating: isSettingLockActive(INSIGHT_LOCK_KEY),
  };
}

export function acquireInsightRegenerationLock(
  status: InsightStatus,
  apiKey: string | null,
): SettingLock | null {
  if (!status.isStale) return null;
  if (apiKey === null) return null;
  return acquireSettingLock(INSIGHT_LOCK_KEY, INSIGHT_LOCK_TTL_MS);
}

export async function regenerateInsight(
  userId: number,
  apiKey: string,
  lock: SettingLock,
): Promise<void> {
  try {
    const context = getHealthContext(userId, INSIGHT_DAYS);
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: INSIGHT_MODEL,
      thinking: { type: "adaptive" },
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Analyze my Whoop data and give me insights:\n\n${context}`,
        },
      ],
    });
    const insight = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (insight) {
      saveInsight(todayUtc(), insight);
    }
  } catch (err) {
    console.warn("[insight] regeneration_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    releaseSettingLock(lock);
  }
}
