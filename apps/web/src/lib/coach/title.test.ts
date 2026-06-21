import { describe, expect, it } from "vitest";
import { deriveTitleFromText } from "./title";

describe("deriveTitleFromText", () => {
  it("returns short messages unchanged (whitespace collapsed)", () => {
    expect(deriveTitleFromText("How did I sleep?")).toBe("How did I sleep?");
    expect(deriveTitleFromText("  How   did\nI sleep? ")).toBe("How did I sleep?");
  });

  it("truncates long messages at a word boundary with an ellipsis", () => {
    const title = deriveTitleFromText(
      "Compare my average recovery over the last 30 days to the prior 30 days",
    );
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(49);
    // Cut on a space — no dangling partial word, no trailing punctuation.
    expect(title).not.toMatch(/[\s.,;:!?-]…$/);
    expect("Compare my average recovery over the last 30 days").toContain(
      title.slice(0, -1),
    );
  });

  it("hard-cuts a single very long token (no early space)", () => {
    const title = deriveTitleFromText("x".repeat(100));
    expect(title).toBe(`${"x".repeat(48)}…`);
  });

  it("handles empty / whitespace-only input", () => {
    expect(deriveTitleFromText("")).toBe("");
    expect(deriveTitleFromText("   \n  ")).toBe("");
  });
});
