import "server-only";
// Cursor provider key + error types. Unlike Anthropic (per-user BYOK), Cursor
// uses a single SHARED env key. `origin` is therefore always operator-targeted
// in error messaging — there is no per-user Cursor key to blame.

export class MissingCursorKeyError extends Error {
  constructor() {
    super("CURSOR_API_KEY is not configured");
    this.name = "MissingCursorKeyError";
  }
}

export type CursorFailureReason = "auth" | "timeout" | "agent";

export class CursorAgentError extends Error {
  constructor(
    public readonly reason: CursorFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "CursorAgentError";
  }
}

/** Resolve the shared Cursor key; throws MissingCursorKeyError when unset. */
export function resolveCursorKey(): string {
  const key = process.env.CURSOR_API_KEY;
  if (!key) throw new MissingCursorKeyError();
  return key;
}
