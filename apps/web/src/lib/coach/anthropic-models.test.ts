// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { APIError } from "@anthropic-ai/sdk";
import type { ModelInfo } from "@anthropic-ai/sdk/resources/models";
import { effectiveAnthropicEffort } from "./anthropic-model-options";

const list = vi.hoisted(() => vi.fn());
const construct = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@anthropic-ai/sdk", async (importOriginal) => ({
  ...await importOriginal<typeof import("@anthropic-ai/sdk")>(),
  default: class {
    constructor(options: unknown) { construct(options); }
    models = { list };
  },
}));

function model(id: string, capabilities: ModelInfo["capabilities"] = null): ModelInfo {
  return { id, display_name: id, capabilities, max_tokens: 8192,
    max_input_tokens: null, type: "model", created_at: "2026-01-01" };
}

beforeEach(() => {
  vi.resetModules();
  list.mockReset();
  construct.mockReset();
});

describe("Anthropic model discovery", () => {
  it("consumes all pages and caches only within the same credential", async () => {
    list.mockImplementation(() => (async function* () {
      yield model("claude-sonnet-4-6");
      yield model("claude-opus-4-6");
    })());
    const { listAnthropicModelsForKey } = await import("./anthropic-models");
    const first = await listAnthropicModelsForKey("personal-a");
    expect(first.map((entry) => entry.id)).toEqual(["claude-sonnet-4-6", "claude-opus-4-6"]);
    await listAnthropicModelsForKey("personal-a");
    expect(list).toHaveBeenCalledTimes(1);
    await listAnthropicModelsForKey("personal-b");
    expect(list).toHaveBeenCalledTimes(2);
    expect(construct).toHaveBeenNthCalledWith(2, expect.objectContaining({ apiKey: "personal-b" }));
  });

  it("expires cached catalogs", async () => {
    list.mockImplementation(() => (async function* () { yield model("claude-sonnet-4-6"); })());
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      const { listAnthropicModelsForKey } = await import("./anthropic-models");
      await listAnthropicModelsForKey("key");
      now.mockReturnValue(62000);
      await listAnthropicModelsForKey("key");
      expect(list).toHaveBeenCalledTimes(2);
    } finally { now.mockRestore(); }
  });

  it("does not cache failures or expose upstream credential-bearing messages", async () => {
    list.mockImplementationOnce(() => (async function* () {
      throw new APIError(401, {}, "rejected private-key-value", new Headers());
    })()).mockImplementation(() => (async function* () { yield model("claude-sonnet-4-6"); })());
    const { listAnthropicModelsForKey } = await import("./anthropic-models");
    await expect(listAnthropicModelsForKey("key")).rejects.toMatchObject({ reason: "invalid_key", message: "Anthropic model catalog invalid_key" });
    expect(await listAnthropicModelsForKey("key")).toHaveLength(1);
  });

  it("uses authoritative capabilities, including models without thinking", async () => {
    const { anthropicModelOption } = await import("./anthropic-models");
    const capabilities = {
      thinking: { supported: true, types: { adaptive: { supported: true }, enabled: { supported: false } } },
      effort: { supported: true, low: { supported: true }, medium: { supported: false }, high: { supported: true }, xhigh: { supported: true }, max: { supported: false } },
    } as ModelInfo["capabilities"];
    expect(anthropicModelOption(model("new-model", capabilities))).toMatchObject({ thinking: "adaptive", efforts: ["off", "low", "high", "xhigh"], output_effort: true });
    expect(anthropicModelOption(model("claude-sonnet-4-6", {
      ...capabilities!, thinking: { supported: false, types: { adaptive: { supported: false }, enabled: { supported: false } } },
    }))).toMatchObject({ thinking: "none", efforts: ["off"] });
  });

  it("handles legacy metadata conservatively", async () => {
    const { anthropicModelOption } = await import("./anthropic-models");
    expect(anthropicModelOption(model("claude-haiku-4-5-20251001"))).toMatchObject({ thinking: "enabled", efforts: ["off", "low", "medium", "high"] });
    expect(anthropicModelOption(model("unknown-model"))).toMatchObject({ thinking: "none", efforts: ["off"] });
  });

  it("gates None and normalizes saved off when the model rejects disabled thinking", async () => {
    const { anthropicModelOption } = await import("./anthropic-models");
    const newerThinkingTypes = {
      adaptive: { supported: true }, enabled: { supported: false },
      disabled: { supported: false }, between_tools: { supported: true },
    };
    const option = anthropicModelOption(model("claude-sonnet-5-5", {
      batch: { supported: true }, citations: { supported: true },
      code_execution: { supported: true }, image_input: { supported: true },
      pdf_input: { supported: true }, structured_outputs: { supported: true },
      context_management: {
        supported: true, clear_thinking_20251015: null,
        clear_tool_uses_20250919: null, compact_20260112: null,
      },
      thinking: { supported: true, types: newerThinkingTypes },
      effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true }, xhigh: { supported: true }, max: { supported: true } },
    }));
    expect(option.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(effectiveAnthropicEffort(option, "off")).toBe("high");
  });
});
