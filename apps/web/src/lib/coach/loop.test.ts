// @vitest-environment node
//
// Issue #498 — the per-user "Instructions" (user_settings.system_prompt) were
// stored, displayed, and round-tripped by tests, but never reached the model:
// the coach loop built its system prompt without them. Persistence tests
// could not catch that, because the gap was between the DB and the SDK call.
// These tests assert against the params actually handed to the Anthropic SDK.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@anthropic-ai/sdk/resources/messages";

const streamMock = vi.hoisted(() => vi.fn());
const getUserSettingsMock = vi.hoisted(() => vi.fn());
const listModelsMock = vi.hoisted(() => vi.fn());
vi.mock("./anthropic-models", async (importOriginal) => ({
  ...await importOriginal<typeof import("./anthropic-models")>(),
  listAnthropicModelsForKey: listModelsMock,
}));

vi.mock("server-only", () => ({}));
vi.mock("@anthropic-ai/sdk", () => {
  class APIError extends Error {
    status: number | undefined;
  }
  class Anthropic {
    messages = { stream: streamMock };
  }
  return { default: Anthropic, APIError };
});
vi.mock("@/lib/db", () => ({ getUserSettings: getUserSettingsMock }));
vi.mock("./tools", () => ({
  TOOLS: [{ name: "query_sleep", strict: true, input_schema: { type: "object", properties: {} } }],
  newToolTurnState: vi.fn(() => ({
    syncAttempts: 0,
    savedPlanHashes: new Map(),
  })),
  executeToolResult: vi.fn(),
}));

import { runAnthropicSdk, type DetailState, type Usage } from "./loop";
import { DEFAULT_SYSTEM_PROMPT } from "./prompts";
import { executeToolResult } from "./tools";
import { AnthropicModelCatalogError } from "./anthropic-models";
import { BadApiKeyError } from "./api-key";

type SystemBlock = { type: "text"; text: string; cache_control?: unknown };

function fakeStream(overrides: Partial<Message> = {}) {
  const final = {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text: "Recovery is 78%." }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    ...overrides,
  } as unknown as Message;
  return {
    async *[Symbol.asyncIterator]() {
      // No streaming events needed; the loop only needs finalMessage().
    },
    finalMessage: async () => final,
  };
}

/** Run one coach turn for a user whose stored settings are `settings`. */
async function runTurn(
  settings: Record<string, unknown> | null,
): Promise<SystemBlock[]> {
  getUserSettingsMock.mockReturnValue(settings);
  streamMock.mockReturnValue(fakeStream());

  const usage: Usage = {
    input_tokens_total: 0,
    output_tokens_total: 0,
    cache_creation_input_tokens_total: 0,
    cache_read_input_tokens_total: 0,
    calls: 0,
  };
  const detailState: DetailState = { iterations: 0 };

  await runAnthropicSdk(
    1,
    42,
    { displayText: "How am I doing?", modelText: "How am I doing?", images: [] },
    [],
    [],
    usage,
    detailState,
    "sk-test",
    "env",
  );

  expect(streamMock).toHaveBeenCalledTimes(1);
  return streamMock.mock.calls[0][0].system as SystemBlock[];
}

beforeEach(() => {
  streamMock.mockReset();
  getUserSettingsMock.mockReset();
  listModelsMock.mockReset();
  listModelsMock.mockResolvedValue([
    { id: "claude-sonnet-5-5", thinking: "adaptive", efforts: ["off", "low", "medium", "high"], output_effort: true, max_tokens: 64000 },
    { id: "claude-sonnet-4-6", thinking: "adaptive", efforts: ["off", "low", "medium", "high"], output_effort: true, max_tokens: 64000 },
    { id: "claude-opus-4-6", thinking: "adaptive", efforts: ["off", "low", "medium", "high", "max"], output_effort: true, max_tokens: 64000 },
  ]);
});

describe("Anthropic model execution", () => {
  async function execute(model: string) {
    return runAnthropicSdk(1, 42,
      { displayText: "Check my sleep", modelText: "Check my sleep", images: [] },
      [], [], { calls: 0, input_tokens_total: 0, output_tokens_total: 0,
        cache_creation_input_tokens_total: 0, cache_read_input_tokens_total: 0 },
      { iterations: 0 }, "personal-key", "user", {}, undefined, model);
  }

  it("uses the selected model and reasoning on both initial and tool-result calls", async () => {
    getUserSettingsMock.mockReturnValue({ coach_effort: "max" });
    streamMock.mockReturnValueOnce(fakeStream({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tool_1", name: "query_sleep", input: {}, caller: { type: "direct" } }],
    })).mockReturnValueOnce(fakeStream());
    vi.mocked(executeToolResult).mockResolvedValue({ type: "tool_result", tool_use_id: "tool_1", content: "sleep data" });
    await execute("claude-opus-4-6");
    expect(listModelsMock).toHaveBeenCalledWith("personal-key");
    expect(streamMock).toHaveBeenCalledTimes(2);
    for (const [params] of streamMock.mock.calls) {
      expect(params).toMatchObject({ model: "claude-opus-4-6", thinking: { type: "adaptive" }, output_config: { effort: "max" } });
    }
  });

  it("clamps unsupported effort instead of sending max to Sonnet", async () => {
    getUserSettingsMock.mockReturnValue({ coach_effort: "max" });
    streamMock.mockReturnValue(fakeStream());
    await execute("claude-sonnet-4-6");
    expect(streamMock.mock.calls[0][0].output_config).toEqual({ effort: "high" });
  });

  it("omits strict tool schemas for models that do not support structured output", async () => {
    listModelsMock.mockResolvedValue([{ id: "legacy", thinking: "none", efforts: ["off"], max_tokens: 4096, strict_tools: false }]);
    streamMock.mockReturnValue(fakeStream());
    await execute("legacy");
    const params = streamMock.mock.calls[0][0];
    expect(params.tools[0]).not.toHaveProperty("strict");
    expect(params.tools[0].name).toBe("query_sleep");
    expect(params).not.toHaveProperty("thinking");
    expect(params.max_tokens).toBe(4096);
  });

  it("retains strict tool schemas when advertised by the model", async () => {
    listModelsMock.mockResolvedValue([{ id: "strict-model", thinking: "none", efforts: ["off"], max_tokens: 4096, strict_tools: true }]);
    streamMock.mockReturnValue(fakeStream());
    await execute("strict-model");
    expect(streamMock.mock.calls[0][0].tools[0].strict).toBe(true);
  });

  it("uses a conservative token cap when legacy metadata omits the ceiling", async () => {
    listModelsMock.mockResolvedValue([{ id: "legacy", thinking: "enabled", efforts: ["off", "high"], max_tokens: null }]);
    getUserSettingsMock.mockReturnValue({ coach_effort: "high" });
    streamMock.mockReturnValue(fakeStream());
    await execute("legacy");
    expect(streamMock.mock.calls[0][0]).toMatchObject({
      max_tokens: 4096, thinking: { type: "enabled", budget_tokens: 4095 },
    });
  });

  it("rejects a removed model without spending on another model", async () => {
    await expect(execute("removed-model")).rejects.toThrow("no longer available");
    expect(streamMock).not.toHaveBeenCalled();
  });

  it("preserves the key-origin error when discovery rejects the personal key", async () => {
    listModelsMock.mockRejectedValue(new AnthropicModelCatalogError("invalid_key"));
    await expect(execute("claude-sonnet-4-6")).rejects.toEqual(new BadApiKeyError("user"));
    expect(streamMock).not.toHaveBeenCalled();
  });
});

describe("runAnthropicSdk system prompt wiring (issue #498)", () => {
  it("passes the user's stored system_prompt to the model", async () => {
    const system = await runTurn({
      system_prompt: "Always mention my HRV trend.",
    });

    expect(
      system.some((block) => block.text.includes("Always mention my HRV trend.")),
    ).toBe(true);
  });

  it("keeps the built-in prompt alongside the custom instructions", async () => {
    const system = await runTurn({ system_prompt: "Only reply in haiku." });

    // Additive, not replacement: the safety rules must survive a custom
    // prompt. Replacement semantics would let this user's coach invent
    // health numbers.
    expect(system[1].text).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(system[1].text).toContain("never invent values");
  });

  it("leaves the cached default block untouched when instructions are set", async () => {
    const withCustom = await runTurn({ system_prompt: "be terse" });
    streamMock.mockReset();
    const baseline = await runTurn({ system_prompt: null });

    expect(withCustom[1]).toEqual(baseline[1]);
    expect(withCustom[1].cache_control).toEqual({
      type: "ephemeral",
      ttl: "1h",
    });
    // The custom block itself must NOT be cached — per-user text in a cached
    // block is a cache write per user for a single read.
    expect(withCustom[withCustom.length - 1]).not.toHaveProperty(
      "cache_control",
    );
  });

  it("appends instructions after the goals block", async () => {
    const system = await runTurn({
      coach_goals: ["sleep_better"],
      system_prompt: "be terse",
    });

    expect(system).toHaveLength(4);
    expect(system[2].text).toContain("sleep better");
    expect(system[3].text).toContain("be terse");
  });

  // Cache protection: a user with a blank textarea must produce exactly the
  // prompt the coach sent before this feature existed.
  it.each([
    ["null", null],
    ["undefined (no settings row)", undefined],
    ["an empty string", ""],
    ["a whitespace-only string", "   "],
  ])("sends a byte-identical prompt for %s", async (_label, value) => {
    streamMock.mockReset();
    const baseline = await runTurn({});
    streamMock.mockReset();
    const actual = await runTurn({ system_prompt: value });

    expect(JSON.stringify(actual)).toBe(JSON.stringify(baseline));
    expect(actual).toHaveLength(2);
  });

  it("sends the same prompt when the user has no settings row at all", async () => {
    const noRow = await runTurn(null);
    streamMock.mockReset();
    const blank = await runTurn({ system_prompt: null });

    expect(JSON.stringify(noRow)).toBe(JSON.stringify(blank));
  });
});

describe("runAnthropicSdk phase timing (issue #585)", () => {
  it("records first_text_ms from the first streamed assistant text", async () => {
    getUserSettingsMock.mockReturnValue(null);
    const final = {
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "Recovery is 78%." }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    } as unknown as Message;
    streamMock.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Recovery is 78%." },
        };
      },
      finalMessage: async () => final,
    });
    const detailState: DetailState = { iterations: 0 };

    await runAnthropicSdk(
      1,
      42,
      { displayText: "How am I doing?", modelText: "How am I doing?", images: [] },
      [],
      [],
      {
        input_tokens_total: 0,
        output_tokens_total: 0,
        cache_creation_input_tokens_total: 0,
        cache_read_input_tokens_total: 0,
        calls: 0,
      },
      detailState,
      "sk-test",
      "env",
      { onTextDelta: () => {} },
    );

    expect(typeof detailState.first_text_ms).toBe("number");
    expect(detailState.first_text_ms).toBeGreaterThanOrEqual(0);
  });
});
