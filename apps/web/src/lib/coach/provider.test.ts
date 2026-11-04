// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUserSettingsMock = vi.fn();
vi.mock("@/lib/db", () => ({
  getUserSettings: (...args: unknown[]) => getUserSettingsMock(...args),
}));

import {
  ANTHROPIC_PREF,
  CURSOR_PREF,
  anthropicReasoningConfig,
  cursorProviderEnabled,
  parseCoachEffort,
  parseModelPref,
  resolveCoachProvider,
} from "./provider";
import type { AnthropicModelOption } from "./anthropic-model-options";

const adaptiveModel: AnthropicModelOption = {
  id: "claude-opus-4-6", display_name: "Opus", thinking: "adaptive",
  efforts: ["off", "low", "medium", "high", "max"], max_tokens: 64000,
  output_effort: true,
};

describe("parseModelPref", () => {
  it("defaults null/undefined to the Anthropic default", () => {
    expect(parseModelPref(null)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
    expect(parseModelPref(undefined)).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
    });
  });

  it("parses the known anthropic + cursor prefs", () => {
    expect(parseModelPref(ANTHROPIC_PREF).provider).toBe("anthropic");
    expect(parseModelPref(CURSOR_PREF)).toEqual({
      provider: "cursor",
      model: "composer-2.5-fast",
    });
  });

  it("preserves an existing Cursor base-model preference", () => {
    expect(parseModelPref("cursor:composer-2.5")).toEqual({
      provider: "cursor",
      model: "composer-2.5",
    });
  });

  it("accepts dynamically discovered Cursor model preferences", () => {
    expect(parseModelPref("cursor:gpt-5.5-high")).toEqual({
      provider: "cursor",
      model: "gpt-5.5-high",
    });
  });

  it("preserves dynamically discovered Anthropic models", () => {
    expect(parseModelPref("anthropic:claude-opus-4-6")).toEqual({
      provider: "anthropic", model: "claude-opus-4-6",
    });
    expect(parseModelPref("anthropic: model").model).toBe("claude-sonnet-4-6");
  });

  it("falls back malformed/legacy values to Anthropic", () => {
    expect(parseModelPref("garbage:x").provider).toBe("anthropic");
    expect(parseModelPref("claude-sonnet-4-6").provider).toBe("anthropic");
    expect(parseModelPref("cursor:model with spaces").provider).toBe(
      "anthropic",
    );
    expect(parseModelPref("cursor:--help").provider).toBe("anthropic");
  });
});

describe("parseCoachEffort", () => {
  it("accepts supported levels and defaults invalid values to high", () => {
    expect(parseCoachEffort("off")).toBe("off");
    expect(parseCoachEffort("low")).toBe("low");
    expect(parseCoachEffort("medium")).toBe("medium");
    expect(parseCoachEffort("high")).toBe("high");
    expect(parseCoachEffort("max")).toBe("max");
    expect(parseCoachEffort("xhigh")).toBe("xhigh");
    expect(parseCoachEffort(null)).toBe("high");
  });
});

describe("anthropicReasoningConfig", () => {
  it("disables thinking when effort is off", () => {
    expect(anthropicReasoningConfig("off", adaptiveModel, 16384)).toEqual({
      thinking: { type: "disabled" },
    });
  });

  it("uses adaptive thinking for active effort levels", () => {
    expect(anthropicReasoningConfig("max", adaptiveModel, 16384)).toEqual({
      thinking: { type: "adaptive" },
      output_config: { effort: "max" },
    });
  });

  it("uses a supported effort when switching from Opus to Sonnet", () => {
    const model = { ...adaptiveModel, efforts: ["off", "high"] as const };
    expect(anthropicReasoningConfig("max", { ...model, efforts: [...model.efforts] }, 16384))
      .toEqual({ thinking: { type: "adaptive" }, output_config: { effort: "high" } });
  });

  it("sends token budgets for older models and no thinking for unsupported models", () => {
    expect(anthropicReasoningConfig("high", { ...adaptiveModel, thinking: "enabled" }, 8192))
      .toEqual({ thinking: { type: "enabled", budget_tokens: 8191 } });
    expect(anthropicReasoningConfig("high", { ...adaptiveModel, thinking: "none", efforts: ["off"] }, 4096))
      .toEqual({});
  });

  it("omits effort when the API reports adaptive thinking without effort", () => {
    expect(anthropicReasoningConfig("high", { ...adaptiveModel, output_effort: false }, 16384))
      .toEqual({ thinking: { type: "adaptive" } });
  });

  it("avoids disabled thinking when a model advertises only active efforts", () => {
    expect(anthropicReasoningConfig("off", {
      ...adaptiveModel, efforts: ["low", "medium", "high", "max"],
    }, 16384)).toEqual({ thinking: { type: "adaptive" }, output_config: { effort: "high" } });
  });
});

describe("cursorProviderEnabled", () => {
  const orig = process.env.CURSOR_API_KEY;
  afterEach(() => {
    getUserSettingsMock.mockReset();
    if (orig === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = orig;
  });

  it("is true when a personal key exists", () => {
    delete process.env.CURSOR_API_KEY;
    getUserSettingsMock.mockReturnValue({ cursor_key: "crsr_personal" });
    expect(cursorProviderEnabled(1)).toBe(true);
    expect(getUserSettingsMock).toHaveBeenCalledWith(1);
  });

  it("falls back to CURSOR_API_KEY", () => {
    getUserSettingsMock.mockReturnValue({ cursor_key: null });
    process.env.CURSOR_API_KEY = "crsr_test";
    expect(cursorProviderEnabled(1)).toBe(true);
    delete process.env.CURSOR_API_KEY;
    expect(cursorProviderEnabled(1)).toBe(false);
  });

  it("resolves the selected model's persisted Cursor parameters", () => {
    delete process.env.CURSOR_API_KEY;
    getUserSettingsMock.mockReturnValue({
      cursor_key: "crsr_personal",
      model_pref: "cursor:gpt-5.5",
      cursor_model_params: {
        "gpt-5.5": [{ id: "effort", value: "high" }],
      },
    });

    expect(resolveCoachProvider(1)).toEqual({
      provider: "cursor",
      model: "gpt-5.5",
      parameters: [{ id: "effort", value: "high" }],
    });
  });

  it("preserves an unavailable provider instead of falling back to paid Anthropic", () => {
    delete process.env.CURSOR_API_KEY;
    getUserSettingsMock.mockReturnValue({ model_pref: "cursor:gpt-5.5" });
    expect(resolveCoachProvider(1)).toEqual({ provider: "cursor", model: "gpt-5.5", parameters: [] });
  });
});
