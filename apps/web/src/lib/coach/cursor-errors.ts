export type CursorKeyOrigin = "user" | "env";
export type CursorFailureReason = "auth" | "timeout" | "agent";

/**
 * How the cursor-agent subprocess ended, as Node's `close` event reports it.
 * Exactly one of `code` / `signal` is non-null for a real exit: a process
 * killed by a signal closes with `code === null` and the signal name. Before
 * issue #475-C only `code` was kept, so every signal death (SIGKILL from a
 * memory-pressured cgroup, SIGSEGV from a crash) logged as "exited null".
 */
export interface CursorExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

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
    public readonly exit?: CursorExitInfo,
  ) {
    super(message);
    this.name = "CursorAgentError";
  }
}

/** Human-readable process-exit description for logs and error messages. */
export function describeCursorExit(exit: CursorExitInfo): string {
  if (exit.signal) {
    return exit.code === null
      ? `killed by ${exit.signal}`
      : `exited ${exit.code} (signal ${exit.signal})`;
  }
  return `exited ${exit.code}`;
}
