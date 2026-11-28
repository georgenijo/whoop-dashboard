// @vitest-environment node
//
// Issue #623 — deterministic reply-latency and token-usage coverage for the
// Anthropic Coach loop. Every case in __fixtures__/coach-reply-workload.json
// runs through the real runAnthropicSdk with a mocked SDK stream and mocked
// tool reads, so no inference or network is involved. Each case asserts model
// call count, tool calls (server prefetch + model-chosen), uncached input /
// output / cache-read / cache-creation totals, and whether the first request
// carried server-fetched context or fell back to the ordinary tool loop.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@anthropic-ai/sdk/resources/messages";
import workload from "./__fixtures__/coach-reply-workload.json";

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
  newToolTurnState: vi.fn(() => ({ syncAttempts: 0, savedPlanHashes: new Map() })),
  executeToolResult: vi.fn(),
}));

import { runAnthropicSdk, type DetailState, type Usage } from "./loop";
import { executeToolResult } from "./tools";
import type { CoachConversationMessage, CoachImage } from "./image-types";

type TurnUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number | null;
  cache_read_input_tokens: number | null;
};
type WorkloadCase = {
  id: string;
  category: string;
  live: boolean;
  text: string;
  history?: boolean;
  image?: boolean;
  prefetch: null | {
    tool: string;
    input: { start_date: string; end_date: string };
    result: { content: string; is_error?: boolean };
    delay_ms?: number;
    used: boolean;
  };
  model_turns: Array<{
    tool_uses?: Array<{ name: string; input: Record<string, unknown> }>;
    usage: TurnUsage;
  }>;
  tool_results?: Record<string, string>;
  expect: {
    model_calls: number;
    iterations: number;
    tool_calls: string[];
    usage: Omit<Usage, "calls">;
  };
};

const cases = workload.cases as WorkloadCase[];
const SERVER_CONTEXT = "Server-fetched health context for this request";

function modelMessage(turn: WorkloadCase["model_turns"][number], index: number): Message {
  const toolUses = (turn.tool_uses ?? []).map((tool, i) => ({
    type: "tool_use", id: `tool_${index}_${i}`, name: tool.name, input: tool.input,
    caller: { type: "direct" },
  }));
  return {
    id: `msg_${index}`, type: "message", role: "assistant", model: "claude-sonnet-5-5",
    content: toolUses.length > 0 ? toolUses : [{ type: "text", text: "Grounded answer." }],
    stop_reason: toolUses.length > 0 ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: turn.usage,
  } as unknown as Message;
}

function image(): CoachImage {
  return {
    id: "img_1", mimeType: "image/jpeg", width: 1, height: 1,
    bytes: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), sha256: "0".repeat(64),
  };
}

async function runCase(c: WorkloadCase) {
  c.model_turns.forEach((turn, i) => {
    streamMock.mockReturnValueOnce({
      async *[Symbol.asyncIterator]() {},
      finalMessage: async () => modelMessage(turn, i),
    });
  });
  vi.mocked(executeToolResult).mockImplementation(async (_threadId, tool) => {
    if (tool.id.startsWith("server_prefetch_")) {
      if (!c.prefetch) throw new Error(`${c.id}: unexpected server prefetch`);
      // A slow read is simulated by advancing the faked clock, so duration_ms
      // is exact without the test waiting in real time.
      if (c.prefetch.delay_ms) vi.setSystemTime(Date.now() + c.prefetch.delay_ms);
      return { type: "tool_result", tool_use_id: tool.id, ...c.prefetch.result };
    }
    const content = c.tool_results?.[tool.name];
    if (content === undefined) throw new Error(`${c.id}: no fixture result for ${tool.name}`);
    return { type: "tool_result", tool_use_id: tool.id, content };
  });
  const history: CoachConversationMessage[] = c.history ? [
    { role: "user", contentBlocks: [{ type: "text", text: "How was my recovery today?" }], images: [] },
    { role: "assistant", contentBlocks: [{ type: "text", text: "Recovery is 78%." }], images: [] },
  ] : [];
  const usage: Usage = {
    calls: 0, input_tokens_total: 0, output_tokens_total: 0,
    cache_creation_input_tokens_total: 0, cache_read_input_tokens_total: 0,
  };
  const detailState: DetailState = { iterations: 0 };
  const result = await runAnthropicSdk(7, 42,
    { displayText: c.text, modelText: c.text, images: c.image ? [image()] : [] },
    history, [], usage, detailState, "personal-key", "user");
  return { result, usage, detailState };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(workload.now));
  streamMock.mockReset();
  vi.mocked(executeToolResult).mockReset();
  getUserSettingsMock.mockReturnValue({ coach_effort: "medium" });
  listModelsMock.mockResolvedValue([
    { id: "claude-sonnet-5-5", thinking: "adaptive", efforts: ["off", "low", "medium", "high"], output_effort: true, max_tokens: 64000 },
  ]);
});
afterEach(() => vi.useRealTimers());

describe("Coach reply workload fixture is internally consistent", () => {
  it.each(cases.map((c) => [c.id, c] as const))("%s: expected totals equal the scripted usage", (_id, c) => {
    expect(c.expect.model_calls).toBe(c.model_turns.length);
    const sum = (key: keyof TurnUsage) => c.model_turns.reduce((n, t) => n + (t.usage[key] ?? 0), 0);
    expect(c.expect.usage).toEqual({
      input_tokens_total: sum("input_tokens"),
      output_tokens_total: sum("output_tokens"),
      cache_creation_input_tokens_total: sum("cache_creation_input_tokens"),
      cache_read_input_tokens_total: sum("cache_read_input_tokens"),
    });
  });

  it("names a live batch drawn only from defined cases, with recorded runs in the declared shape", () => {
    const live = workload.live_workload;
    const ids = new Set(cases.map((c) => c.id));
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const id of live.case_ids) expect(ids.has(id)).toBe(true);
    expect(cases.filter((c) => c.live).map((c) => c.id).sort()).toEqual([...live.case_ids].sort());
    // The issue's live list: recovery + sleep, a follow-up, multi-domain, slow/missing data.
    expect(live.case_ids.length).toBeGreaterThanOrEqual(5);
    for (const run of live.runs as Array<Record<string, unknown>>) {
      expect(Object.keys(run).sort()).toEqual([...live.record_fields].sort());
      expect(ids.has(run.case_id as string)).toBe(true);
    }
    if (live.status === "not_run") expect(live.runs).toEqual([]);
  });
});

describe("Coach reply latency and token usage (deterministic, issue #623)", () => {
  it.each(cases.map((c) => [c.id, c] as const))("%s", async (_id, c) => {
    const { result, usage, detailState } = await runCase(c);

    // Model round-trips, tool-loop iterations, and every tool execution
    // (server prefetch first, then model-chosen calls in order).
    expect(streamMock).toHaveBeenCalledTimes(c.expect.model_calls);
    expect(usage.calls).toBe(c.expect.model_calls);
    expect(result.iterations).toBe(c.expect.iterations);
    expect(detailState.iterations).toBe(c.expect.iterations);
    expect(vi.mocked(executeToolResult).mock.calls.map(([, tool]) => tool.name)).toEqual(c.expect.tool_calls);

    // Uncached input, output, and cache read/write totals from the usage objects.
    expect(usage).toEqual({ calls: c.expect.model_calls, ...c.expect.usage });

    // Speed never comes from a quieter model or effort: every call keeps the selection.
    for (const [params] of streamMock.mock.calls) {
      expect(params).toMatchObject({ model: "claude-sonnet-5-5", thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
    }

    // Prefetch versus fallback.
    const firstRequest = JSON.stringify(streamMock.mock.calls[0][0].messages);
    if (c.prefetch) {
      expect(detailState.prefetch).toEqual({
        source: "server", tool: c.prefetch.tool, input: c.prefetch.input,
        duration_ms: c.prefetch.delay_ms ?? 0, used: c.prefetch.used,
      });
    } else {
      expect(detailState.prefetch).toBeUndefined();
    }
    expect(firstRequest.includes(SERVER_CONTEXT)).toBe(c.prefetch?.used ?? false);

    // The persisted user message stays verbatim and the turn ends in an answer.
    expect(result.messages[0]).toMatchObject({ role: "user", content: c.text });
    expect(result.reply).toBe("Grounded answer.");
    expect(JSON.stringify(result.messages)).not.toContain(SERVER_CONTEXT);
  });
});
