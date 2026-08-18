export type CursorKeyOrigin = "user" | "env";
export type CursorFailureReason = "auth" | "timeout" | "agent";

export class MissingCursorKeyError extends Error {
  constructor() {
    super("No Cursor API key configured");
    this.name = "MissingCursorKeyError";
  }
}

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
