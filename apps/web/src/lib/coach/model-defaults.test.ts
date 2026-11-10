// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FALLBACK_CHAT_MODEL,
  FALLBACK_INSIGHT_MODEL,
  FALLBACK_TITLE_MODEL,
  defaultChatModel,
  insightModel,
  resolveConfiguredModel,
  titleModel,
} from "./model-defaults";
import type { AnthropicModelOption } from "./anthropic-model-options";

function option(id: string, overrides: Partial<AnthropicModelOption> = {}): AnthropicModelOption {
  return {
    id,
    display_name: id,
    thinking: "adaptive",
    efforts: ["off", "low", "medium", "high"],
    max_tokens: 64000,
    output_effort: true,
    ...overrides,
  };
}

// Realistic account catalog: the Models API lists newest first, so the same
// family appears in that order.
const catalog = [
  option("claude-sonnet-5-5"),
  option("claude-sonnet-4-6"),
  option("claude-haiku-5-5", { thinking: "enabled" }),
  option("claude-haiku-4-5-20251001", { thinking: "enabled" }),
  option("claude-opus-4-6", { efforts: ["off", "low", "medium", "high", "max"] }),
];

beforeEach(() => {
  // The warn-once registry is process-scoped; keep test output quiet and
  // assertions independent.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("default model getters", () => {
  it("returns the shipped fallbacks when no env override is set", () => {
    expect(defaultChatModel()).toBe(FALLBACK_CHAT_MODEL);
    expect(FALLBACK_CHAT_MODEL).toMatch(/^claude-sonnet-\d+-\d+$/);
    expect(titleModel()).toBe(FALLBACK_TITLE_MODEL);
    expect(FALLBACK_TITLE_MODEL).toMatch(/^claude-haiku-\d+-\d+$/);
    expect(insightModel()).toBe(FALLBACK_INSIGHT_MODEL);
    expect(FALLBACK_INSIGHT_MODEL).toBe(FALLBACK_TITLE_MODEL);
  });

  it("honors env overrides over the shipped fallbacks", () => {
    vi.stubEnv("COACH_DEFAULT_MODEL", "claude-opus-4-6 ");
    vi.stubEnv("COACH_TITLE_MODEL", "claude-haiku-7-7");
    vi.stubEnv("COACH_INSIGHT_MODEL", "claude-sonnet-9-9");
    expect(defaultChatModel()).toBe("claude-opus-4-6");
    expect(titleModel()).toBe("claude-haiku-7-7");
    expect(insightModel()).toBe("claude-sonnet-9-9");
  });

  it("ignores blank env overrides", () => {
    vi.stubEnv("COACH_DEFAULT_MODEL", "   ");
    expect(defaultChatModel()).toBe(FALLBACK_CHAT_MODEL);
  });
});

describe("resolveConfiguredModel", () => {
  it("keeps a configured model that the catalog contains, with its capabilities", () => {
    expect(resolveConfiguredModel(catalog, "claude-sonnet-5-5")).toEqual({
      model: "claude-sonnet-5-5",
      option: catalog[0],
    });
  });

  it("falls back to the newest same-family model when the configured one is missing", () => {
    const { model, option: resolved } = resolveConfiguredModel(catalog, "claude-sonnet-6-1");
    expect(model).toBe("claude-sonnet-5-5");
    expect(resolved).toBe(catalog[0]);
    // A versioned legacy ID without a date sticker still matches its family.
    const haiku = resolveConfiguredModel(catalog, "claude-haiku-9-9");
    expect(haiku.model).toBe("claude-haiku-5-5");
  });

  it("normalizes legacy Anthropic model IDs to their family before falling back", () => {
    // Legacy layout: claude-<major>-<minor>-<family>-<date>.
    const legacyHaiku = resolveConfiguredModel(catalog, "claude-3-5-haiku-20241022");
    expect(legacyHaiku.model).toBe("claude-haiku-5-5");
    expect(legacyHaiku.option).toBe(catalog[2]);
    const legacySonnet = resolveConfiguredModel(catalog, "claude-3-7-sonnet-20250219");
    expect(legacySonnet.model).toBe("claude-sonnet-5-5");
    // Legacy single-digit layout: claude-<major>-<family>-<date>.
    expect(resolveConfiguredModel(catalog, "claude-3-haiku-20240307").model)
      .toBe("claude-haiku-5-5");
  });

  it("sends an unresolvable configured model unverified with no capabilities", () => {
    expect(resolveConfiguredModel(catalog, "composer-2.5-fast")).toEqual({
      model: "composer-2.5-fast",
      option: null,
    });
  });

  it("handles an empty catalog", () => {
    expect(resolveConfiguredModel([], "claude-sonnet-5-5")).toEqual({
      model: "claude-sonnet-5-5",
      option: null,
    });
  });

  it("warns once per configured model, not on every call", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) resolveConfiguredModel(catalog, "claude-sonnet-8-8");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('configured model "claude-sonnet-8-8"');
    expect(warn.mock.calls[0][0]).toContain('falling back to "claude-sonnet-5-5"');
    resolveConfiguredModel(catalog, "claude-haiku-7-7");
    expect(warn).toHaveBeenCalledTimes(2);
    resolveConfiguredModel([], "warn-test-unresolvable");
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[2][0]).toContain("sending it unverified");
  });

  it("does not warn for configured models present in the catalog", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    resolveConfiguredModel(catalog, "claude-haiku-4-5-20251001");
    expect(warn).not.toHaveBeenCalled();
  });
});
