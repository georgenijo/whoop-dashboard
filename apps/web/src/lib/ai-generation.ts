import "server-only";
import { createHash } from "node:crypto";
import {
  clearGenerationFailure,
  getGenerationFailure,
  saveGenerationFailure,
  type GenerationFailure,
  type GenerationKind,
  type GenerationErrorClass,
} from "@/lib/db/ai-generation";
import { acquireSettingLock, releaseSettingLock, type SettingLock } from "@/lib/db/settings";
import { forModule } from "@/lib/logger";

const log = forModule("ai-generation");
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
// SDK retries are bounded by a total deadline shorter than this lease.
export const GENERATION_LOCK_TTL_MS = 5 * 60_000;
export const GENERATION_DEADLINE_MS = 125_000;
export const GENERATION_CLIENT_OPTIONS = { timeout: 60_000, maxRetries: 1 };

export function generationLockKey(userId: number, kind: GenerationKind): string {
  return `ai_generation:${kind}:${userId}`;
}

function keyHash(apiKey: string | null): string | null {
  return apiKey ? createHash("sha256").update(apiKey).digest("hex") : null;
}

export function retryAt(failure: GenerationFailure): string {
  const delay = BACKOFF_MS[Math.min(failure.failure_count - 1, BACKOFF_MS.length - 1)];
  return new Date(Date.parse(failure.last_failed_at) + delay).toISOString();
}

export function classifyGenerationError(error: unknown): GenerationErrorClass {
  const status = typeof error === "object" && error !== null && "status" in error ? error.status : null;
  return status === 401 || status === 403 ? "bad_key" : "provider_error";
}

export function recordGenerationFailure(
  userId: number, kind: GenerationKind, errorClass: GenerationErrorClass, apiKey: string | null,
): void {
  saveGenerationFailure(userId, kind, errorClass, keyHash(apiKey));
  // Persist only a safe reason class, never provider text that could contain credentials.
  log.error({ user_id: userId, kind, error_class: errorClass }, `${kind}_failed`);
}

export function acquireGenerationLock(
  userId: number, kind: GenerationKind, apiKey: string | null,
): SettingLock | null {
  const hash = keyHash(apiKey);
  const blocked = (failure: GenerationFailure | null) => failure !== null && failure.key_hash === hash && (
    (kind === "title" && failure.error_class === "bad_key") || Date.now() < Date.parse(retryAt(failure))
  );
  // The common failure path needs only a small scoped read, not a schema write.
  if (blocked(getGenerationFailure(userId, kind))) return null;
  const lock = acquireSettingLock(generationLockKey(userId, kind), GENERATION_LOCK_TTL_MS);
  if (!lock) return null;
  let keepLock = false;
  try {
    // Re-read AFTER the atomic lock acquisition: a page's status snapshot may
    // predate another request's completed failure.
    if (blocked(getGenerationFailure(userId, kind))) return null;
    if (!apiKey) {
      recordGenerationFailure(userId, kind, "no_key", null);
      return null;
    }
    keepLock = true;
    return lock;
  } finally {
    if (!keepLock) releaseSettingLock(lock);
  }
}

export { clearGenerationFailure };
