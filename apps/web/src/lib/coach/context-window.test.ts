import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTEXT_WINDOW,
  contextLevel,
  contextWindowFor,
  formatTokenCount,
} from "./context-window";

describe("contextWindowFor (issue #608)", () => {
  it("prefers the Models API input limit when the catalog reports one", () => {
    expect(contextWindowFor("anthropic:claude-sonnet-5-5", 1_000_000)).toBe(1_000_000);
  });

  it("falls back to the family table without catalog data", () => {
    expect(contextWindowFor("anthropic:claude-sonnet-5-5")).toBe(200_000);
    expect(contextWindowFor("anthropic:claude-sonnet-5-5", null)).toBe(200_000);
    expect(contextWindowFor("cursor:sonnet-4.5")).toBe(200_000);
    expect(contextWindowFor("cursor:gpt-5.6-luna")).toBe(272_000);
    expect(contextWindowFor("cursor:gemini-3-pro")).toBe(1_048_576);
  });

  it("uses the conservative default for unknown models and junk limits", () => {
    expect(contextWindowFor("cursor:mystery-model")).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(contextWindowFor("cursor:mystery-model", 0)).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(contextWindowFor("cursor:mystery-model", Number.NaN)).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});

describe("contextLevel", () => {
  it("turns amber at 75% and red at 90%", () => {
    expect(contextLevel(149_999, 200_000)).toBe("ok");
    expect(contextLevel(150_000, 200_000)).toBe("warn");
    expect(contextLevel(179_999, 200_000)).toBe("warn");
    expect(contextLevel(180_000, 200_000)).toBe("danger");
    expect(contextLevel(250_000, 200_000)).toBe("danger");
  });
});

describe("formatTokenCount", () => {
  it("formats compactly", () => {
    expect(formatTokenCount(850)).toBe("850");
    expect(formatTokenCount(1_250)).toBe("1.3k");
    expect(formatTokenCount(42_123)).toBe("42k");
    expect(formatTokenCount(200_000)).toBe("200k");
    expect(formatTokenCount(999_600)).toBe("1M");
    expect(formatTokenCount(1_048_576)).toBe("1M");
    expect(formatTokenCount(1_500_000)).toBe("1.5M");
  });
});
