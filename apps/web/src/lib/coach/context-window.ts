/**
 * Issue #608 — context-window meter helpers. Client-safe (no server imports).
 *
 * The Anthropic Models API reports each model's `max_input_tokens`; that wins
 * whenever the catalog has it. Otherwise (Cursor models, catalog not loaded
 * yet, older API responses) fall back to a small family table, then to a
 * conservative default. A too-small window only makes the meter warn early;
 * a too-large one would hide a nearly-full thread, so unknown models get the
 * smallest common window.
 */

export const DEFAULT_CONTEXT_WINDOW = 200_000;

export const CONTEXT_WARN_RATIO = 0.75;
export const CONTEXT_DANGER_RATIO = 0.9;

// Matched against the bare model id (provider prefix stripped), first hit wins.
const CONTEXT_WINDOW_TABLE: ReadonlyArray<readonly [RegExp, number]> = [
  [/\[1m\]|-1m(?:$|-)/i, 1_000_000],
  [/^(?:claude-)?(?:opus|sonnet|haiku)|^claude-/i, 200_000],
  [/^gemini-/i, 1_048_576],
  [/^gpt-5/i, 272_000],
  [/^gpt-4\.1/i, 1_047_576],
];

export function contextWindowFor(
  modelPref: string,
  catalogMaxInputTokens?: number | null,
): number {
  if (
    typeof catalogMaxInputTokens === "number" &&
    Number.isFinite(catalogMaxInputTokens) &&
    catalogMaxInputTokens > 0
  ) {
    return catalogMaxInputTokens;
  }
  const id = modelPref.replace(/^(anthropic|cursor):/, "");
  for (const [pattern, window] of CONTEXT_WINDOW_TABLE) {
    if (pattern.test(id)) return window;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

export type ContextLevel = "ok" | "warn" | "danger";

export function contextLevel(tokens: number, window: number): ContextLevel {
  const ratio = window > 0 ? tokens / window : 1;
  if (ratio >= CONTEXT_DANGER_RATIO) return "danger";
  if (ratio >= CONTEXT_WARN_RATIO) return "warn";
  return "ok";
}

/** Compact token count: 850, 42k, 1.2M. */
export function formatTokenCount(tokens: number): string {
  const n = Math.max(0, Math.round(tokens));
  if (n < 1000) return String(n);
  const k = n / 1000;
  if (k < 10) return `${Number(k.toFixed(1))}k`;
  if (Math.round(k) < 1000) return `${Math.round(k)}k`;
  return `${Number((n / 1_000_000).toFixed(1))}M`;
}
