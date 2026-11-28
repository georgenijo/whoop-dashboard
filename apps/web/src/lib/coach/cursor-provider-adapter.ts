import "server-only";

import {
  runCursorTurn,
  type RunCursorTurnArgs,
  type RunCursorTurnResult,
} from "./cursor-loop";
import { cursorTransport } from "./cursor-transport";
import { assertCursorSpawnMemory } from "./cursor-memory";

export async function runCursorProviderTurn(
  args: RunCursorTurnArgs,
): Promise<RunCursorTurnResult> {
  if (cursorTransport() === "legacy") {
    // Every legacy turn spawns a fresh cursor-agent. Default-off pre-flight
    // (COACH_CURSOR_MIN_AVAILABLE_MB): fail fast with an explicit out-of-memory
    // error instead of spawning into a cgroup at its ceiling (issue #475-A).
    // ACP is excluded: a warm session reuses a live process and spawns nothing.
    assertCursorSpawnMemory();
    return runCursorTurn(args);
  }

  const { runCursorAcpTurn } = await import("./cursor-acp-turn");
  return runCursorAcpTurn(args);
}
