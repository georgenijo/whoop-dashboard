export type CursorTransport = "legacy" | "acp";

export function cursorTransport(): CursorTransport {
  return process.env.COACH_CURSOR_TRANSPORT === "acp" ? "acp" : "legacy";
}
