import "server-only";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { after } from "next/server";
import {
  getHealthContext,
  getLatestInsight,
  getLatestWhoopDataTimestamp,
  type InsightRow,
} from "@/lib/db";
import { getInsightToday as insightToday, saveInsight } from "@/lib/db/summary";
import { getGenerationFailure, type GenerationErrorClass } from "@/lib/db/ai-generation";
import { isSettingLockActive, releaseSettingLock, type SettingLock } from "@/lib/db/settings";
import { resolveCatalogModel } from "@/lib/coach/model-resolution";
import { resolveApiKeyForUser } from "@/lib/coach/api-key";
import { insightModel } from "@/lib/coach/model-defaults";
import { DEFAULT_COACH_EFFORT, anthropicReasoningConfig } from "@/lib/coach/provider";
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
import { forModule } from "@/lib/logger";

const log = forModule("insights");

const INSIGHT_MAX_TOKENS = 2048;
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

export { insightToday };

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** sha256 of the exact prompt context, so staleness tracks the brief's inputs. */
export function insightInputsHash(context: string): string {
  return createHash("sha256").update(context).digest("hex");
}

function needsRegeneration(
  userId: number, insight: InsightRow | null, latestDataAt: string | null, today: string,
): boolean {
  if (!latestDataAt) return false;
  if (!insight) return true;
  if (insight.date !== today) return true;

  // A brief records what it was written from. Any new, corrected, or deleted
  // row inside the window changes the context, even when its provider
  // timestamp predates the brief (e.g. a recovery that landed mid-generation).
  if (insight.inputs_hash) {
    return insightInputsHash(getHealthContext(userId, INSIGHT_DAYS)) !== insight.inputs_hash;
  }

  // Legacy rows written before inputs_hash existed.
  const insightCreatedMs = parseTime(insight.created_at);
  const latestDataMs = parseTime(latestDataAt);
  if (insightCreatedMs === null || latestDataMs === null) return true;

  return latestDataMs > insightCreatedMs;
}

export function getInsightStatus(userId: number, hasData: boolean): InsightStatus {
  const today = insightToday(userId);
  const insight = getLatestInsight(userId, today);
  const failure = getGenerationFailure(userId, "insight");
  const latestDataAt = hasData ? getLatestWhoopDataTimestamp(userId) : null;
  const isStale = hasData && needsRegeneration(userId, insight, latestDataAt, today);
  return {
    userId,
    today,
    insight,
    isStale,
    // A queued pregeneration worker will rewrite a stale brief, so clients
    // keep polling across the gap between one pass's lock and the next.
    isRegenerating: isSettingLockActive(generationLockKey(userId, "insight"))
      || (isStale && pregenerations.has(userId)),
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

export type InsightRefresh = {
  status: InsightStatus;
  refreshing: boolean;
};

// The one request-time entry point for brief generation, shared by the web
// Overview and /api/ios/dashboard. Resolves the BYOK key, takes the same lock
// and retry/backoff gate, and schedules generation in after() so the caller
// never waits on the model. Missing credentials are persisted as a visible
// failure by the gate rather than thrown. Must run inside a request scope.
export function scheduleInsightRegeneration(userId: number, hasData: boolean): InsightRefresh {
  const { status, lock, apiKey } = claimInsightRegeneration(userId, hasData);
  if (lock !== null && apiKey !== null) {
    after(async () => {
      await regenerateInsight(userId, apiKey, lock);
      // Data that committed mid-write leaves this brief stale; hand off so it
      // is rewritten without waiting for another request.
      if (getInsightStatus(userId, hasData).isStale) await requestPregeneration(userId, 0);
    });
  }
  return { status, refreshing: status.isRegenerating || lock !== null };
}

function claimInsightRegeneration(userId: number, hasData: boolean): {
  status: InsightStatus;
  lock: SettingLock | null;
  apiKey: string | null;
} {
  const before = getInsightStatus(userId, hasData);
  let apiKey: string | null = null;
  try {
    apiKey = resolveApiKeyForUser(userId).key;
  } catch {
    apiKey = null;
  }
  // A current brief needs no lock, so the first read already is the answer.
  if (!before.isStale) return { status: before, lock: null, apiKey };
  const lock = acquireInsightRegenerationLock(before, apiKey);
  return { status: getInsightStatus(userId, hasData), lock, apiKey };
}

// Whoop's sleep.updated and recovery.updated for the same night arrive within
// milliseconds of each other, followed by cycle refreshes. Waiting lets the
// whole burst land so one generation covers it instead of a sleep-only brief
// that is immediately stale again.
export const INSIGHT_PREGENERATE_DELAY_MS = 20_000;
/** Most generation passes one worker makes, however many webhooks join it. */
export const INSIGHT_PREGENERATE_MAX_PASSES = 3;
/** How often a worker rechecks a lock another caller holds. */
export const INSIGHT_PREGENERATE_LOCK_POLL_MS = 5_000;
/**
 * Overall worker budget after the debounce. Covers waiting out a holder that
 * runs to its full message deadline plus catalog lookup, then writing.
 */
export const INSIGHT_PREGENERATE_DEADLINE_MS = 6 * 60_000;

// One in-process worker per user (production is a single `next start`
// process). Webhooks that arrive while one is queued or running join it, so
// a burst costs at most INSIGHT_PREGENERATE_MAX_PASSES generations in total.
const pregenerations = new Map<number, Promise<boolean>>();

function requestPregeneration(userId: number, delayMs: number): Promise<boolean> {
  const existing = pregenerations.get(userId);
  if (existing) return existing;
  const run = runPregeneration(userId, delayMs)
    .catch((err) => {
      // regenerateInsight records its own failures; this only guards the
      // status/lock reads from escaping into the after() runner.
      log.error({ user_id: userId, err: err instanceof Error ? err.message : String(err) }, "insight_pregenerate_failed");
      return false;
    })
    .finally(() => pregenerations.delete(userId));
  pregenerations.set(userId, run);
  return run;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPregeneration(userId: number, delayMs: number): Promise<boolean> {
  if (delayMs > 0) await sleep(delayMs);
  const deadline = Date.now() + INSIGHT_PREGENERATE_DEADLINE_MS;
  let passes = 0;
  while (passes < INSIGHT_PREGENERATE_MAX_PASSES && Date.now() < deadline) {
    // Every iteration re-runs every gate: stale inputs, local date, data
    // present, freshly resolved key, and backoff.
    const { lock, apiKey } = claimInsightRegeneration(userId, true);
    if (lock !== null && apiKey !== null) {
      await regenerateInsight(userId, apiKey, lock);
      passes++;
      continue;
    }
    // Wait out a pass another caller holds, then recheck what it saved.
    if (!isSettingLockActive(generationLockKey(userId, "insight"))) break;
    await sleep(INSIGHT_PREGENERATE_LOCK_POLL_MS);
  }
  return passes > 0;
}

/**
 * Regenerate the brief if new Whoop data has made it stale, so the next app
 * open reads a finished brief instead of waiting on the model. Joins the
 * user's queued or running worker if there is one. Resolves true when this
 * worker made at least one generation attempt.
 */
export function pregenerateInsight(userId: number): Promise<boolean> {
  return requestPregeneration(userId, 0);
}

/**
 * Called after a Whoop webhook changes a user's data. Runs in after(), so the
 * webhook's 200 to Whoop never waits on the delay or the model, and Next
 * keeps the process alive for it. Must run inside a request scope.
 */
export function scheduleInsightPregeneration(userId: number): void {
  after(async () => {
    await requestPregeneration(userId, INSIGHT_PREGENERATE_DELAY_MS);
  });
}

export async function regenerateInsight(
  userId: number,
  apiKey: string,
  lock: SettingLock,
): Promise<void> {
  try {
    // One pass per lock, as before. If data commits while the model is
    // writing, the saved inputs_hash no longer matches and the brief stays
    // stale for the next caller (pregenerateInsight retries for webhooks).
    const date = insightToday(userId);
    const context = getHealthContext(userId, INSIGHT_DAYS);
    const insight = await writeInsight(apiKey, context);
    saveInsight(userId, date, insight, insightInputsHash(context));
    clearGenerationFailure(userId, "insight");
  } catch (err) {
    recordGenerationFailure(userId, "insight", classifyGenerationError(err), apiKey);
  } finally {
    releaseSettingLock(lock);
  }
}

async function writeInsight(apiKey: string, context: string): Promise<string> {
  const client = new Anthropic({ apiKey, ...GENERATION_CLIENT_OPTIONS });
  // Issue #587 — resolve the configured insight model against the account
  // catalog (same-family fallback) and build the request's thinking/effort
  // fields through anthropicReasoningConfig so they are only sent to models
  // that accept them. Insight generation keeps the coach's default effort.
  const { model, option } = await resolveCatalogModel(apiKey, insightModel());
  const response = await client.messages.create({
    model,
    max_tokens: INSIGHT_MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analyze my Whoop data and give me insights:\n\n${context}`,
      },
    ],
    ...(option ? anthropicReasoningConfig(DEFAULT_COACH_EFFORT, option, INSIGHT_MAX_TOKENS) : {}),
  }, { signal: AbortSignal.timeout(GENERATION_DEADLINE_MS) });
  const insight = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!insight) throw new Error("Empty insight response");
  return insight;
}
