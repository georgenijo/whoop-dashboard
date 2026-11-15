// @vitest-environment node
//
// Issue #498 — the per-user "Instructions" (user_settings.system_prompt) were
// stored, displayed, and round-tripped by tests, but never reached the model:
// the coach loop built its system prompt without them. Persistence tests
// could not catch that, because the gap was between the DB and the SDK call.
// These tests assert against the params actually handed to the Anthropic SDK.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import type { CoachConversationMessage } from "./image-types";

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

describe("server read before the first Anthropic inference", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-14T17:00:00Z"));
    getUserSettingsMock.mockReturnValue({ coach_effort: "medium" });
    vi.mocked(executeToolResult).mockReset();
    streamMock.mockReturnValue(fakeStream());
  });
  afterEach(() => vi.useRealTimers());

  async function runRead(options: { signal?: AbortSignal; history?: CoachConversationMessage[]; text?: string } = {}) {
    const detailState: DetailState = { iterations: 0 };
    const result = await runAnthropicSdk(7, 42,
      { displayText: options.text ?? "How did I sleep last night?", modelText: options.text ?? "How did I sleep last night?", images: [] },
      options.history ?? [], [],
      { calls: 0, input_tokens_total: 0, output_tokens_total: 0, cache_creation_input_tokens_total: 0, cache_read_input_tokens_total: 0 },
      detailState, "personal-key", "user", { signal: options.signal });
    return { result, detailState };
  }

  it("provides scoped data before inference, preserving model, effort, and persisted user text", async () => {
    vi.mocked(executeToolResult).mockImplementation(async (_id, tool) => ({
      type: "tool_result", tool_use_id: tool.id,
      content: '[{"date":"2026-11-14","performance":82}]',
    }));
    const { result, detailState } = await runRead();
    expect(executeToolResult).toHaveBeenCalledWith(42, expect.objectContaining({
      id: expect.stringMatching(/^server_prefetch_/), name: "query_sleep",
      input: { start_date: "2026-11-14", end_date: "2026-11-14" },
    }), expect.any(Array), expect.objectContaining({ userId: 7, turnState: expect.any(Object) }));
    expect(streamMock).toHaveBeenCalledTimes(1);
    const params = streamMock.mock.calls[0][0];
    expect(params).toMatchObject({ model: "claude-sonnet-5-5", thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
    expect(params.messages.at(-1).role).toBe("user");
    expect(JSON.stringify(params.messages.at(-1).content)).toContain('\\"performance\\":82');
    expect(result.messages[0]).toMatchObject({ role: "user", content: "How did I sleep last night?", blocks: [{ type: "text", text: "How did I sleep last night?" }] });
    expect(result.messages).toHaveLength(2);
    expect(detailState.prefetch).toMatchObject({ source: "server", tool: "query_sleep", used: true });
    expect(JSON.stringify(params.system)).not.toContain('"performance":82');
  });

  it.each([
    ["empty", "[]", false], ["error", '{"error":"unavailable"}', true],
    ["oversized", "x".repeat(20_001), false],
  ])("keeps the first model request unmodified on %s data", async (_name, content, is_error) => {
    vi.mocked(executeToolResult).mockResolvedValue({ type: "tool_result", tool_use_id: "unused", content, is_error });
    const { detailState } = await runRead();
    expect(detailState.prefetch?.used).toBe(false);
    expect(streamMock.mock.calls[0][0].messages).toEqual([{ role: "user", content: [expect.objectContaining({ type: "text", text: "How did I sleep last night?" })] }]);
  });

  it("retains sync and re-query when the current read is empty", async () => {
    vi.mocked(executeToolResult)
      .mockResolvedValueOnce({ type: "tool_result", tool_use_id: "prefetch", content: "[]" })
      .mockResolvedValueOnce({ type: "tool_result", tool_use_id: "sync", content: '{"success":true}' })
      .mockResolvedValueOnce({ type: "tool_result", tool_use_id: "read", content: '[{"date":"2026-11-14"}]' });
    streamMock.mockReset();
    streamMock.mockReturnValueOnce(fakeStream({ stop_reason: "tool_use", content: [
      { type: "tool_use", id: "sync", name: "trigger_whoop_sync", input: {}, caller: { type: "direct" } },
    ] })).mockReturnValueOnce(fakeStream({ stop_reason: "tool_use", content: [
      { type: "tool_use", id: "read", name: "query_sleep", input: { start_date: "2026-11-14", end_date: "2026-11-14" }, caller: { type: "direct" } },
    ] })).mockReturnValueOnce(fakeStream());
    await runRead();
    expect(vi.mocked(executeToolResult).mock.calls.map(([, tool]) => tool.name))
      .toEqual(["query_sleep", "trigger_whoop_sync", "query_sleep"]);
    const states = vi.mocked(executeToolResult).mock.calls.map((call) => call[3].turnState);
    expect(states[1]).toBe(states[0]); expect(states[2]).toBe(states[0]);
    expect(streamMock).toHaveBeenCalledTimes(3);
  });

  it("leaves an empty wrapped workout read on the ordinary model path", async () => {
    vi.mocked(executeToolResult).mockResolvedValue({
      type: "tool_result", tool_use_id: "prefetch",
      content: '{"rows":[],"_meta":{"total_count":0,"truncated":false}}',
    });
    const { detailState } = await runRead({ text: "Show my workouts today" });
    expect(detailState.prefetch).toMatchObject({ tool: "query_workouts", used: false });
    expect(streamMock.mock.calls[0][0].messages[0].content).toHaveLength(1);
  });

  it("does not fetch or send private rows when the request opts out", async () => {
    await runRead({ text: "How was my recovery today? Don't query my data; explain generally." });
    expect(executeToolResult).not.toHaveBeenCalled();
    expect(streamMock.mock.calls[0][0].messages[0].content).toHaveLength(1);
  });

  it("leaves follow-ups on the ordinary path", async () => {
    await runRead({ history: [{ role: "user", contentBlocks: [{ type: "text", text: "Earlier question" }], images: [] }] });
    expect(executeToolResult).not.toHaveBeenCalled();
  });

  it("starts no work for an already cancelled turn", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(runRead({ signal: controller.signal })).rejects.toThrow();
    expect(executeToolResult).not.toHaveBeenCalled(); expect(streamMock).not.toHaveBeenCalled();
  });

  it("passes cancellation through the read and starts no inference after cancellation", async () => {
    const controller = new AbortController();
    vi.mocked(executeToolResult).mockImplementation(async (_id, tool, _details, options) => {
      expect(options.signal).toBe(controller.signal); controller.abort();
      return { type: "tool_result", tool_use_id: tool.id, content: "[]" };
    });
    await expect(runRead({ signal: controller.signal })).rejects.toThrow();
    expect(streamMock).not.toHaveBeenCalled();
  });
});
