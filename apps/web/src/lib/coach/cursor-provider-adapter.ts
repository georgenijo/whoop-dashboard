import "server-only";

import {
  runCursorTurn,
  type RunCursorTurnArgs,
  type RunCursorTurnResult,
} from "./cursor-loop";
import { cursorTransport } from "./cursor-transport";

export async function runCursorProviderTurn(
  args: RunCursorTurnArgs,
): Promise<RunCursorTurnResult> {
  if (cursorTransport() === "legacy") {
    return runCursorTurn(args);
  }

  const { runCursorAcpTurn } = await import("./cursor-acp-turn");
  return runCursorAcpTurn(args);
}
