import "server-only";

/**
 * Server-side gate for the Cmd/Ctrl-K quick-jump palette. Default OFF: only
 * the exact string "1" enables it. Read in the dashboard layout so that with
 * the flag off the client component is never referenced in the RSC payload —
 * no chunk, no key listener, no header button.
 */
export function isCommandPaletteEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.COMMAND_PALETTE === "1";
}
