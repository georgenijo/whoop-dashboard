import "server-only";

import { execFile } from "node:child_process";
import { getUserSettings } from "@/lib/db";

export type CursorKeyOrigin = "user" | "env";
export type ResolvedCursorKey = {
  key: string;
  origin: CursorKeyOrigin;
};
export type CursorKeyProbeResult = "ok" | "invalid_key" | "probe_failed";

export class MissingCursorKeyError extends Error {
  constructor() {
    super("No Cursor API key configured");
    this.name = "MissingCursorKeyError";
  }
}

export type CursorFailureReason = "auth" | "timeout" | "agent";

export class CursorAgentError extends Error {
  constructor(
    public readonly reason: CursorFailureReason,
    message: string,
    public readonly origin?: CursorKeyOrigin,
  ) {
    super(message);
    this.name = "CursorAgentError";
  }
}

/** Resolve a user's Cursor key. Personal BYOK wins; the server key is fallback. */
export function resolveCursorKey(userId: number): ResolvedCursorKey {
  const settings = getUserSettings(userId);
  if (settings?.cursor_key) {
    return { key: settings.cursor_key, origin: "user" };
  }
  const env = process.env.CURSOR_API_KEY;
  if (env) return { key: env, origin: "env" };
  throw new MissingCursorKeyError();
}

/**
 * Validate a Cursor key without spending a model turn. `cursor-agent models`
 * authenticates and lists the account's models; an invalid key exits nonzero
 * with an auth-specific diagnostic.
 */
export function probeCursorKey(key: string): Promise<CursorKeyProbeResult> {
  const bin = process.env.COACH_CURSOR_AGENT_BIN || "cursor-agent";
  return new Promise((resolve) => {
    execFile(
      bin,
      ["models"],
      {
        env: { ...process.env, CURSOR_API_KEY: key },
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 256 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve("ok");
          return;
        }
        const diagnostic = `${stdout}\n${stderr}\n${error.message}`;
        if (
          /invalid.*key|key.*invalid|unauthor|forbidden|\b401\b|\b403\b/i.test(
            diagnostic,
          )
        ) {
          resolve("invalid_key");
          return;
        }
        resolve("probe_failed");
      },
    );
  });
}
