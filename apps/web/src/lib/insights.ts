import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import {
  getHealthContext,
  getLatestInsight,
  getLatestWhoopDataTimestamp,
  type InsightRow,
} from "@/lib/db";
import { getInsightTimezone, saveInsight } from "@/lib/db/summary";
import { getGenerationFailure, type GenerationErrorClass } from "@/lib/db/ai-generation";
import { isSettingLockActive, releaseSettingLock, type SettingLock } from "@/lib/db/settings";
import {
  acquireGenerationLock,
  classifyGenerationError,
  clearGenerationFailure,
  generationLockKey,
  GENERATION_CLIENT_OPTIONS,
  GENERATION_DEADLINE_MS,
  recordGenerationFailure,
  retryAt,
} from "@/lib/ai-generation";

const INSIGHT_MODEL = "claude-sonnet-4-6";
const INSIGHT_DAYS = 30;

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
  userId: number;
  today: string;
  insight: InsightRow | null;
  isStale: boolean;
  isRegenerating: boolean;
  errorClass: GenerationErrorClass | null;
  nextRetryAt: string | null;
};

export function insightToday(userId: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: getInsightTimezone(userId), year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function needsRegeneration(insight: InsightRow | null, latestDataAt: string | null, today: string): boolean {
  if (!latestDataAt) return false;
  if (!insight) return true;
  if (insight.date !== today) return true;

  const insightCreatedMs = parseTime(insight.created_at);
  const latestDataMs = parseTime(latestDataAt);
  if (insightCreatedMs === null || latestDataMs === null) return true;

  return latestDataMs > insightCreatedMs;
}

export function getInsightStatus(userId: number, hasData: boolean): InsightStatus {
  const insight = getLatestInsight(userId);
  const failure = getGenerationFailure(userId, "insight");
  const today = insightToday(userId);
  const latestDataAt = hasData ? getLatestWhoopDataTimestamp(userId) : null;
  return {
    userId,
    today,
    insight,
    isStale: hasData && needsRegeneration(insight, latestDataAt, today),
    isRegenerating: isSettingLockActive(generationLockKey(userId, "insight")),
    errorClass: failure?.error_class ?? null,
    nextRetryAt: failure ? retryAt(failure) : null,
  };
}

export function acquireInsightRegenerationLock(
  status: InsightStatus,
  apiKey: string | null,
): SettingLock | null {
  if (!status.isStale) return null;
  return acquireGenerationLock(status.userId, "insight", apiKey);
}

export async function regenerateInsight(
  userId: number,
  apiKey: string,
  lock: SettingLock,
): Promise<void> {
  try {
    const date = insightToday(userId);
    const context = getHealthContext(userId, INSIGHT_DAYS);
    const client = new Anthropic({ apiKey, ...GENERATION_CLIENT_OPTIONS });
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
    }, { signal: AbortSignal.timeout(GENERATION_DEADLINE_MS) });
    const insight = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!insight) throw new Error("Empty insight response");
    saveInsight(userId, date, insight);
    clearGenerationFailure(userId, "insight");
  } catch (err) {
    recordGenerationFailure(userId, "insight", classifyGenerationError(err), apiKey);
  } finally {
    releaseSettingLock(lock);
  }
}
