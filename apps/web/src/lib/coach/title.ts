// Deterministic fallback title from the first user message. Used when the LLM
// title call is unavailable — e.g. the coach runs on the Cursor provider, or the
// Anthropic key has no credits (titling is Anthropic-only). Beats leaving the
// thread as "New chat" forever. Collapses whitespace and cuts to a word
// boundary near 48 chars. Pure (no server-only deps) so it's unit-testable.
export function deriveTitleFromText(firstUserText: string): string {
  const cleaned = firstUserText.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 48) return cleaned;
  const slice = cleaned.slice(0, 48);
  const lastSpace = slice.lastIndexOf(" ");
  const base = lastSpace > 24 ? slice.slice(0, lastSpace) : slice;
  return `${base.replace(/[\s.,;:!?\-]+$/, "")}…`;
}
