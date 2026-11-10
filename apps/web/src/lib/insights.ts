import "server-only";
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import {
  acquireSettingLock,
  clearAnthropicKeyRejected,
  getAnthropicKeyRejectedAt,
  getHealthContext,
  getInsightFailureState,
  getLatestInsight,
  getLatestWhoopDataTimestamp,
  getUserSettings,
  isSettingLockActive,
  markAnthropicKeyRejected,
  recordInsightFailure,
  releaseSettingLock,
  saveInsight,
  type InsightErrorClass,
  type InsightRow,
  type SettingLock,
} from "@/lib/db";
import { dateInTimezone } from "@/lib/date";
import { forModule } from "@/lib/logger";

const INSIGHT_MODEL = "claude-sonnet-4-6";
const INSIGHT_DAYS = 30;
const INSIGHT_LOCK_TTL_MS = 5 * 60 * 1000;
const INSIGHT_REQUEST_TIMEOUT_MS = 60_000;
const INSIGHT_MAX_RETRIES = 1;

/** Retry delays after consecutive failures: 1 minute, 5 minutes, then 30
 *  minutes for every further failure. */
const INSIGHT_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

const log = forModule("insights");

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

export type InsightUnavailableReason =
  | InsightErrorClass
  | "no_key";

export type InsightFailure = {
  errorClass: InsightUnavailableReason;
  at: string | null;
};

export type InsightStatus = {
  insight: InsightRow | null;
  isStale: boolean;
  isRegenerating: boolean;
  /** Last failure, or a bad-key marker with no failure row. */
  failure: InsightFailure | null;
  keyRejected: boolean;
  /** Earliest time the next generation attempt is allowed, or null. */
  retryAt: string | null;
  canAttempt: boolean;
};

export function insightLockKey(userId: number): string {
  return `insight_regen_in_flight:${userId}`;
}

export function insightRetryDelayMs(failureCount: number): number {
  const index = Math.min(Math.max(failureCount, 1) - 1, INSIGHT_RETRY_DELAYS_MS.length - 1);
  return INSIGHT_RETRY_DELAYS_MS[index];
}

/** The user's local calendar day, from their stored timezone. */
export function userToday(userId: number, now: Date = new Date()): string {
  return dateInTimezone(now, getUserSettings(userId)?.tz ?? null);
}

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function needsRegeneration(
  insight: InsightRow | null,
  latestDataAt: string | null,
  today: string,
): boolean {
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
  const latestDataAt = hasData ? getLatestWhoopDataTimestamp(userId) : null;
  const failureState = getInsightFailureState(userId);
  const rejectedAt = getAnthropicKeyRejectedAt(userId);
  const retryAt = failureState
    ? new Date(
        Date.parse(failureState.last_failed_at) +
          insightRetryDelayMs(failureState.failure_count),
      ).toISOString()
    : null;
  const keyRejected = rejectedAt !== null;
  const backoffActive = retryAt !== null && Date.parse(retryAt) > Date.now();

  return {
    insight,
    isStale: hasData && needsRegeneration(insight, latestDataAt, userToday(userId)),
    isRegenerating: isSettingLockActive(insightLockKey(userId)),
    failure: failureState
      ? { errorClass: failureState.last_error_class, at: failureState.last_failed_at }
      : keyRejected
        ? { errorClass: "bad_key", at: rejectedAt }
        : null,
    keyRejected,
    retryAt,
    canAttempt: !keyRejected && !backoffActive,
  };
}

/** Reason to show in the card for a stale insight, if one is known. */
export function insightUnavailableReason(
  status: InsightStatus,
  hasApiKey: boolean,
): InsightUnavailableReason | null {
  if (!status.isStale) return null;
  if (!hasApiKey) return "no_key";
  return status.failure?.errorClass ?? null;
}

export function acquireInsightRegenerationLock(
  userId: number,
  status: InsightStatus,
  apiKey: string | null,
): SettingLock | null {
  if (!status.isStale) return null;
  if (apiKey === null) return null;
  // A rejected key or an active failure backoff must not spend another call.
  if (!status.canAttempt) return null;
  return acquireSettingLock(insightLockKey(userId), INSIGHT_LOCK_TTL_MS);
}

function classifyInsightError(err: unknown): InsightErrorClass {
  if (err instanceof APIError && (err.status === 401 || err.status === 403)) {
    return "bad_key";
  }
  return "provider_error";
}

export async function regenerateInsight(
  userId: number,
  apiKey: string,
  lock: SettingLock,
): Promise<void> {
  try {
    const context = getHealthContext(userId, INSIGHT_DAYS);
    const client = new Anthropic({
      apiKey,
      timeout: INSIGHT_REQUEST_TIMEOUT_MS,
      maxRetries: INSIGHT_MAX_RETRIES,
    });
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

    if (!insight) {
      throw new Error("empty insight response");
    }

    saveInsight(userId, userToday(userId), insight);
    clearAnthropicKeyRejected(userId);
  } catch (err) {
    const errorClass = classifyInsightError(err);
    recordInsightFailure(userId, errorClass);
    if (errorClass === "bad_key") {
      markAnthropicKeyRejected(userId);
    }
    log.error(
      {
        user_id: userId,
        error_class: errorClass,
        err: err instanceof Error ? err.message : String(err),
      },
      "insight_regeneration_failed",
    );
  } finally {
    releaseSettingLock(lock);
  }
}
