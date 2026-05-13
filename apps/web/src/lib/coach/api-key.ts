import "server-only";
// Per-request resolver for the Anthropic API key used by the Coach loop and
// the AI Insight regen. BYOK precedence:
//   1. user_settings.anthropic_key (decrypted via vault) — personal/BYOK key
//   2. process.env.ANTHROPIC_API_KEY                     — shared server key
//   3. neither → MissingApiKeyError                      — caller surfaces 503
//
// `origin` is plumbed alongside the key so downstream error handling can
// translate an upstream 401 into a user-targeted "your key was rejected"
// banner (origin === "user") vs. an operator-targeted "server key broken"
// log (origin === "env"). The Coach loop wraps the SDK call and rethrows
// upstream 401s as `BadApiKeyError` carrying the origin.
import { getUserSettings } from "@/lib/db";

export type ApiKeyOrigin = "user" | "env";

export class MissingApiKeyError extends Error {
  constructor() {
    super("No Anthropic API key configured");
    this.name = "MissingApiKeyError";
  }
}

export class BadApiKeyError extends Error {
  constructor(public readonly origin: ApiKeyOrigin) {
    super(`Anthropic API key rejected (origin=${origin})`);
    this.name = "BadApiKeyError";
  }
}

export type ResolvedApiKey = { key: string; origin: ApiKeyOrigin };

/**
 * Resolve the Anthropic API key for a user. BYOK wins; env is the fallback.
 *
 * Throws `MissingApiKeyError` when neither source has a key. Callers should
 * translate that into a 503 (chat) or treat as "skip regen" (insights).
 */
export function resolveApiKeyForUser(userId: number): ResolvedApiKey {
  const settings = getUserSettings(userId);
  if (settings?.anthropic_key) {
    return { key: settings.anthropic_key, origin: "user" };
  }
  const env = process.env.ANTHROPIC_API_KEY;
  if (env) return { key: env, origin: "env" };
  throw new MissingApiKeyError();
}
