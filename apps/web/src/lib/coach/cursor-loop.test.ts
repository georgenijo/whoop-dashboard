// @vitest-environment node
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("@/lib/db", () => ({
  getUserSettings: vi.fn(() => ({ coach_goals: null })),
}));
vi.mock("@/lib/db/connection", () => ({
  dbPath: vi.fn(() => "/tmp/test-whoop.db"),
}));
vi.mock("./prompts", () => ({
  buildCursorSystemPrompt: vi.fn(() => "System prompt"),
}));
vi.mock("./tools", () => ({
  newToolTurnState: vi.fn(() => ({
    syncAttempts: 0,
    savedPlanHashes: new Map(),
  })),
  executeTool: vi.fn(async () => ({
    recovery: [],
    sleep: [],
    strain: [],
    workouts: { rows: [] },
  })),
}));
vi.mock("./cursor-key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cursor-key")>();
  return {
    ...actual,
    resolveCursorKey: vi.fn(() => ({
      key: "cursor-test-key",
      origin: "user",
    })),
  };
});

import {
  parseCursorTerminalResult,
  runCursorTurn,
  selectRecentPrefetchTool,
} from "./cursor-loop";
import type { DetailState, Usage } from "./loop";
import { CURSOR_COMPOSER_MODEL } from "./provider";
import { executeTool } from "./tools";

type FakeChild = EventEmitter & {
  pid: number | undefined;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

function fakeChild(pid?: number): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  return child;
}

function baseArgs(
  detailState: DetailState,
  onTextDelta = vi.fn(),
  signal?: AbortSignal,
  model = CURSOR_COMPOSER_MODEL,
) {
  const usage: Usage = {
    input_tokens_total: 0,
    output_tokens_total: 0,
    cache_creation_input_tokens_total: 0,
    cache_read_input_tokens_total: 0,
    calls: 0,
  };
  return {
    userId: 1,
    model,
    threadId: 10,
    newUserText: "How am I doing?",
    conversation: [
      { role: "user" as const, content: "How am I doing?" },
    ],
    toolDetails: [],
    usage,
    detailState,
    options: { onTextDelta, signal },
  };
}

async function waitForSpawn(): Promise<void> {
  await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  spawnMock.mockReset();
});

describe("parseCursorTerminalResult", () => {
  it("parses the observed snake-case success schema", () => {
    expect(
      parseCursorTerminalResult({
        type: "result",
        subtype: "success",
        result: "Final answer",
        duration_ms: 2_041,
        duration_api_ms: 1_876,
        is_error: false,
        model: "composer-2.5",
      }),
    ).toEqual({
      subtype: "success",
      isError: false,
      resultText: "Final answer",
      errorText: "",
      durationMs: 2_041,
      apiDurationMs: 1_876,
      model: "composer-2.5",
    });
  });

  it("accepts camel-case fields and identifies terminal failures", () => {
    expect(
      parseCursorTerminalResult({
        type: "RESULT",
        subtype: "error_during_execution",
        error: { message: "upstream failed" },
        durationMs: 500,
        durationApiMs: 450,
        isError: true,
      }),
    ).toEqual({
      subtype: "error_during_execution",
      isError: true,
      resultText: "",
      errorText: '{"message":"upstream failed"}',
      durationMs: 500,
      apiDurationMs: 450,
      model: null,
    });
  });

  it("ignores non-terminal and malformed records", () => {
    expect(parseCursorTerminalResult(null)).toBeNull();
    expect(parseCursorTerminalResult({ type: "assistant" })).toBeNull();
  });
});

describe("selectRecentPrefetchTool", () => {
  it.each([
    ["What is my recovery today?", "query_recovery"],
    ["How did I sleep last night?", "query_sleep"],
    ["What is my strain today?", "query_strain"],
    ["Did I train today?", "query_workouts"],
    ["How am I doing today?", "query_daily_snapshot"],
    ["How was today?", "query_daily_snapshot"],
    ["Show me today's metrics", "query_daily_snapshot"],
    ["Give me a current check-in", "query_daily_snapshot"],
    ["Compare my recovery and sleep today", "query_daily_snapshot"],
    ["Show my current workout plan", null],
    ["Analyze my recovery trend this month", null],
  ])("routes %s to %s", (prompt, expected) => {
    expect(selectRecentPrefetchTool(prompt)).toBe(expected);
  });
});

describe("runCursorTurn Cursor lifecycle details", () => {
  it("records init, first text, terminal/API duration, close tail, and cleanup", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const detailState: DetailState = { iterations: 0 };
    const onTextDelta = vi.fn();
    const selectedModel = "gpt-5.5-high";

    const turn = runCursorTurn(
      baseArgs(detailState, onTextDelta, undefined, selectedModel),
    );
    await waitForSpawn();

    child.stdout.write(
      `${JSON.stringify({
        type: "system",
        subtype: "init",
        model: "composer-2.5-resolved",
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Looking good." }] },
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: "tool_call",
        subtype: "started",
        call_id: "internal-mcp",
        tool_call: { startedAtMs: "80" },
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: "tool_call",
        subtype: "completed",
        call_id: "internal-mcp",
        tool_call: { startedAtMs: "80", completedAtMs: "90" },
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: "tool_call",
        subtype: "started",
        call_id: "call-1",
        tool_call: {
          startedAtMs: "100",
          mcpToolCall: {
            args: { toolName: "query_recovery", args: { date: "2026-07-26" } },
          },
        },
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: "tool_call",
        subtype: "completed",
        call_id: "call-1",
        tool_call: {
          startedAtMs: "100",
          completedAtMs: "142",
          mcpToolCall: {
            result: {
              success: {
                isError: false,
                content: [{ text: { text: '{"rows":[]}' } }],
              },
            },
          },
        },
      })}\n`,
    );
    child.stdout.write(
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Looking good.",
        duration_ms: 2_100,
        duration_api_ms: 1_900,
      }),
    );
    child.emit("close", 0);

    const result = await turn;
    expect(result.reply).toBe("Looking good.");
    expect(onTextDelta).toHaveBeenCalledWith("Looking good.");

    const cursor = detailState.cursor;
    expect(cursor).toBeDefined();
    expect(cursor?.requested_model).toBe(selectedModel);
    expect(cursor?.resolved_model).toBe("composer-2.5-resolved");
    expect(cursor?.prefetch).toMatchObject({
      attempted: true,
      loaded: true,
      error: null,
    });
    expect(executeTool).toHaveBeenCalledWith(
      "query_daily_snapshot",
      expect.objectContaining({
        start_date: expect.any(String),
        end_date: expect.any(String),
      }),
      expect.objectContaining({ userId: 1 }),
    );
    const spawnArgs = spawnMock.mock.calls[0]?.[1] as string[];
    expect(spawnArgs[spawnArgs.indexOf("--model") + 1]).toBe(selectedModel);
    expect(spawnArgs.at(-1)).toContain("Preloaded authoritative Whoop data");
    expect(cursor?.terminal_seen).toBe(true);
    expect(cursor?.terminal_subtype).toBe("success");
    expect(cursor?.event_counts).toMatchObject({
      "system:init": 1,
      assistant: 1,
      "tool_call:started": 2,
      "tool_call:completed": 2,
      "result:success": 1,
    });
    expect(cursor?.tool_events).toEqual([
      { name: "query_recovery", phase: "started", at_ms: expect.any(Number) },
      {
        name: "query_recovery",
        phase: "completed",
        at_ms: expect.any(Number),
        duration_ms: 42,
        status: "ok",
      },
    ]);
    expect(cursor?.timing.cursor_duration_ms).toBe(2_100);
    expect(cursor?.timing.cursor_api_duration_ms).toBe(1_900);
    expect(cursor?.timing.spawn_to_system_init_ms).not.toBeNull();
    expect(cursor?.timing.spawn_to_first_assistant_text_ms).not.toBeNull();
    expect(cursor?.timing.spawn_to_first_tool_event_ms).not.toBeNull();
    expect(cursor?.timing.spawn_to_terminal_result_ms).not.toBeNull();
    expect(cursor?.timing.spawn_to_process_close_ms).not.toBeNull();
    expect(cursor?.timing.process_close_tail_ms).not.toBeNull();
    expect(cursor?.timing.cleanup_ms).toBeGreaterThanOrEqual(0);
    expect(cursor?.timing.turn_ms).toBeGreaterThanOrEqual(0);
  });

  it("uses a terminal result as the reply fallback and caps a stuck close tail", async () => {
    const child = fakeChild(4_321);
    spawnMock.mockReturnValue(child);
    const processKill = vi.spyOn(process, "kill").mockReturnValue(true);
    const detailState: DetailState = { iterations: 0 };
    const onTextDelta = vi.fn();

    const turn = runCursorTurn(baseArgs(detailState, onTextDelta));
    await waitForSpawn();
    vi.useFakeTimers();

    child.stdout.write(
      `${JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Recovered terminal answer",
        duration_ms: 1_000,
        duration_api_ms: 900,
      })}\n`,
    );
    await vi.advanceTimersByTimeAsync(251);
    expect(processKill).toHaveBeenCalledWith(-4_321, "SIGTERM");
    child.emit("close", null);

    const result = await turn;
    expect(result.reply).toBe("Recovered terminal answer");
    expect(onTextDelta).toHaveBeenCalledWith("Recovered terminal answer");
    expect(detailState.cursor?.timing.process_close_tail_ms).toBe(251);
  });

  it("does not spawn when the request is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      runCursorTurn(baseArgs({ iterations: 0 }, vi.fn(), controller.signal)),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("treats cancellation after partial text as terminal instead of success", async () => {
    const child = fakeChild(7_654);
    spawnMock.mockReturnValue(child);
    const processKill = vi.spyOn(process, "kill").mockReturnValue(true);
    const controller = new AbortController();
    const onTextDelta = vi.fn();

    const turn = runCursorTurn(
      baseArgs({ iterations: 0 }, onTextDelta, controller.signal),
    );
    await waitForSpawn();
    child.stdout.write(
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Partial answer" }] },
      })}\n`,
    );
    controller.abort();
    expect(processKill).toHaveBeenCalledWith(-7_654, "SIGTERM");
    child.emit("close", null);

    await expect(turn).rejects.toMatchObject({ name: "AbortError" });
    expect(onTextDelta).toHaveBeenCalledWith("Partial answer");
  });
});
