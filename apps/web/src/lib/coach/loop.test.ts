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
  TOOLS: [],
  newToolTurnState: vi.fn(() => ({
    syncAttempts: 0,
    savedPlanHashes: new Map(),
  })),
  executeToolResult: vi.fn(),
}));

import { runAnthropicSdk, type DetailState, type Usage } from "./loop";
import { DEFAULT_SYSTEM_PROMPT } from "./prompts";

type SystemBlock = { type: "text"; text: string; cache_control?: unknown };

function fakeStream() {
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
