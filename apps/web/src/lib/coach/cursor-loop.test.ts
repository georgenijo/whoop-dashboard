// @vitest-environment node
import { EventEmitter } from "node:events";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const getUserSettingsMock = vi.hoisted(() =>
  vi.fn(() => ({ coach_goals: null }) as Record<string, unknown> | null),
);
const buildCursorSystemPromptMock = vi.hoisted(() => vi.fn(() => "System prompt"));

vi.mock("server-only", () => ({}));
vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("@/lib/db", () => ({
  getUserSettings: getUserSettingsMock,
}));
vi.mock("@/lib/db/connection", () => ({
  dbPath: vi.fn(() => "/tmp/test-whoop.db"),
}));
vi.mock("./prompts", () => ({
  buildCursorSystemPrompt: buildCursorSystemPromptMock,
}));
vi.mock("./tools", () => ({
  captureToolResponse: vi.fn((value: unknown) => value),
  redactToolPayload: vi.fn((value: unknown) => value),
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
  CursorVisibleTextAccumulator,
  cursorAgentChildPath,
  parseCursorTerminalResult,
  prepareCursorShimBin,
  runCursorTurn,
  selectRecentPrefetchTool,
  type RunCursorTurnArgs,
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

type FakeChildWithoutStdio = EventEmitter & {
  pid: number | undefined;
  stdout: null;
  stderr: null;
  kill: ReturnType<typeof vi.fn>;
};

// Simulates the "child errors before stdio is available" early-exit: no pid
// (so terminate()'s killTree no-ops instead of touching a real process) and
// null stdout/stderr, matching what node_modules `child_process.spawn` can
// hand back when the underlying fork itself failed.
function fakeChildWithoutStdio(): FakeChildWithoutStdio {
  const child = new EventEmitter() as FakeChildWithoutStdio;
  child.pid = undefined;
  child.stdout = null;
  child.stderr = null;
  child.kill = vi.fn();
  return child;
}

function baseArgs(
  detailState: DetailState,
  onTextDelta = vi.fn(),
  signal?: AbortSignal,
  model = CURSOR_COMPOSER_MODEL,
): RunCursorTurnArgs {
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
    turn: {
      displayText: "How am I doing?",
      modelText: "How am I doing?",
      images: [],
    },
    conversation: [],
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
  // Restore the module-factory defaults: vi.restoreAllMocks() strips the
  // implementations these were created with, and other suites in this file
  // rely on them.
  getUserSettingsMock.mockReset();
  getUserSettingsMock.mockReturnValue({ coach_goals: null });
  buildCursorSystemPromptMock.mockReset();
  buildCursorSystemPromptMock.mockReturnValue("System prompt");
});

describe("CursorVisibleTextAccumulator", () => {
  it("deduplicates incremental fragments and cumulative snapshots", () => {
    const text = new CursorVisibleTextAccumulator();
    expect(text.append("Hello")).toBe("Hello");
    expect(text.append(" ")).toBe(" ");
    expect(text.append("Hello world")).toBe("world");
    expect(text.value()).toBe("Hello world");
  });

  it("clears pre-tool commentary and keeps only post-tool final text", () => {
    const text = new CursorVisibleTextAccumulator();
    text.append("I’ll check that.");
    text.toolBoundary();
    text.append("Your recovery improved.");
    expect(text.value()).toBe("Your recovery improved.");
  });

  it("retains a complete no-tool direct answer", () => {
    const text = new CursorVisibleTextAccumulator();
    text.append("A direct ");
    text.append("answer.");
    expect(text.value()).toBe("A direct answer.");
  });
});

describe("cursorAgentChildPath", () => {
  it("narrows PATH to the workspace shim dir for an absolute production binary", () => {
    // The shim dir carries bash + coreutils for the launcher script but no
    // npx, so optional LSP startup stays skipped without breaking the shebang.
    expect(
      cursorAgentChildPath(
        "/home/george/.local/bin/cursor-agent",
        "/usr/bin:/bin",
        undefined,
        "/tmp/coach-cursor-x/.shim-bin",
      ),
    ).toBe("/tmp/coach-cursor-x/.shim-bin");
  });

  it("keeps PATH for the local name fallback and honors an explicit production override", () => {
    expect(
      cursorAgentChildPath(
        "cursor-agent",
        "/usr/local/bin:/usr/bin",
        undefined,
        "/tmp/coach-cursor-x/.shim-bin",
      ),
    ).toBe("/usr/local/bin:/usr/bin");
    expect(
      cursorAgentChildPath(
        "/opt/cursor-agent",
        "/usr/bin",
        "/opt/coach-runtime",
        "/tmp/coach-cursor-x/.shim-bin",
      ),
    ).toBe("/opt/coach-runtime");
  });
});

describe("prepareCursorShimBin", () => {
  it("symlinks the launcher's tools (bash included) but never npx", async () => {
    const ws = await mkdtemp(path.join(tmpdir(), "shim-test-"));
    try {
      const shimDir = await prepareCursorShimBin(ws, process.env.PATH);
      expect(shimDir).toBe(path.join(ws, ".shim-bin"));
      const entries = await readdir(shimDir);
      // bash is what the real cursor-agent launcher's `#!/usr/bin/env bash`
      // shebang dies on with exit 127 when PATH is empty (thread 126).
      expect(entries).toContain("bash");
      expect(entries).toContain("dirname");
      expect(entries).toContain("basename");
      expect(entries).not.toContain("npx");
      // The links must resolve — a dangling symlink would still exit 127.
      await access(path.join(shimDir, "bash"));
    } finally {
      await rm(ws, { recursive: true, force: true });
    }
  });
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
      usage: null,
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
      usage: null,
    });
  });

  it("ignores non-terminal and malformed records", () => {
    expect(parseCursorTerminalResult(null)).toBeNull();
    expect(parseCursorTerminalResult({ type: "assistant" })).toBeNull();
  });

  // Issue #443 — every persisted chat_logs.usage row was all zeros for the
  // Cursor provider because nothing ever read Cursor's usage field. This
  // event is the REAL terminal `result` event captured from a live
  // `cursor-agent -p --output-format stream-json --mode ask --trust "say hi
  // in exactly two words"` run on 2026-08-17 (see PR body for the full run
  // log) — not a guessed schema.
  it("extracts usage from the real captured terminal result event", () => {
    const captured = {
      type: "result",
      subtype: "success",
      duration_ms: 6498,
      duration_api_ms: 6498,
      is_error: false,
      result: "Hi there!",
      session_id: "6e7cfc7f-7106-4d07-aeb8-f7fb46f5e8ab",
      request_id: "706e4f3a-16bb-4119-906b-2b0c84286c3a",
      usage: {
        inputTokens: 2,
        outputTokens: 7,
        cacheReadTokens: 0,
        cacheWriteTokens: 30876,
      },
    };
    expect(parseCursorTerminalResult(captured)).toEqual({
      subtype: "success",
      isError: false,
      resultText: "Hi there!",
      errorText: "",
      durationMs: 6498,
      apiDurationMs: 6498,
      model: null,
      usage: {
        inputTokens: 2,
        outputTokens: 7,
        cacheReadTokens: 0,
        cacheWriteTokens: 30876,
      },
    });
  });

  it("treats a missing/malformed usage object as absent rather than guessing zeros", () => {
    expect(
      parseCursorTerminalResult({ type: "result", subtype: "success" })?.usage,
    ).toBeNull();
    expect(
      parseCursorTerminalResult({
        type: "result",
        subtype: "success",
        usage: "not an object",
      })?.usage,
    ).toBeNull();
  });

  it("requires at least one recognized usage key, so an empty or renamed-field payload does not fabricate a zero-cost reading", () => {
    expect(
      parseCursorTerminalResult({ type: "result", subtype: "success", usage: {} })
        ?.usage,
    ).toBeNull();
    // A future cursor-agent build renaming inputTokens/outputTokens (e.g. to
    // snake_case) must not silently reintroduce issue #443 as a fabricated
    // "Calls 1 / Input 0 / Output 0" reading.
    expect(
      parseCursorTerminalResult({
        type: "result",
        subtype: "success",
        usage: { input_tokens: 2, output_tokens: 7 },
      })?.usage,
    ).toBeNull();
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

// Issue #498 — the Cursor path must honour the user's stored Instructions
// too. buildCursorSystemPrompt is mocked in this file, so assert the wiring
// here (that the stored value is handed to the builder) and the additive
// composition in prompts.test.ts.
describe("runCursorTurn custom instructions (issue #498)", () => {
  it("passes the user's stored system_prompt to buildCursorSystemPrompt", async () => {
    buildCursorSystemPromptMock.mockReturnValue("System prompt");
    getUserSettingsMock.mockReturnValue({
      coach_goals: ["sleep_better"],
      system_prompt: "Always mention my HRV trend.",
    });
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const turn = runCursorTurn(baseArgs({ iterations: 0 }));
    await waitForSpawn();

    expect(buildCursorSystemPromptMock).toHaveBeenCalledWith(
      expect.any(Date),
      ["sleep_better"],
      "Always mention my HRV trend.",
    );

    child.stdout.end();
    child.emit("close", 0);
    await turn.catch(() => undefined);
  });

  it("passes null when the user has no stored instructions", async () => {
    buildCursorSystemPromptMock.mockReturnValue("System prompt");
    getUserSettingsMock.mockReturnValue({ coach_goals: null });
    const child = fakeChild();
    spawnMock.mockReturnValue(child);

    const turn = runCursorTurn(baseArgs({ iterations: 0 }));
    await waitForSpawn();

    expect(buildCursorSystemPromptMock).toHaveBeenCalledWith(
      expect.any(Date),
      null,
      null,
    );

    child.stdout.end();
    child.emit("close", 0);
    await turn.catch(() => undefined);
  });
});

describe("runCursorTurn Cursor lifecycle details", () => {
  it("records init, first text, terminal/API duration, close tail, and cleanup", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const detailState: DetailState = { iterations: 0 };
    const onTextDelta = vi.fn();
    const selectedModel = "gpt-5.5-high";

    const args = baseArgs(detailState, onTextDelta, undefined, selectedModel);
    args.modelParameters = [{ id: "effort", value: "high" }];
    const turn = runCursorTurn(args);
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
    expect(cursor?.requested_parameters).toEqual([
      { id: "effort", value: "high" },
    ]);
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
    expect(spawnArgs[spawnArgs.indexOf("--model") + 1]).toBe(
      `${selectedModel}[effort=high]`,
    );
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
    // The internal-mcp bookkeeping call has no toolName and must not count;
    // only the real query_recovery call does.
    expect(cursor?.attempted_tool_calls).toBe(1);
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

  it("counts view_chat_image but never persists or logs its base64 result", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const args = baseArgs({ iterations: 0 });
    const attachmentId = "10000000-0000-4000-8000-000000000001";
    args.turn.images = [
      {
        id: attachmentId,
        mimeType: "image/jpeg",
        width: 1,
        height: 1,
        bytes: Buffer.from("distinctive-jpeg"),
        sha256: "a".repeat(64),
      },
    ];
    const turn = runCursorTurn(args);
    await waitForSpawn();

    child.stdout.write(
      `${JSON.stringify({
        type: "tool_call",
        subtype: "started",
        call_id: "image-tool",
        tool_call: {
          startedAtMs: "100",
          mcpToolCall: {
            args: {
              toolName: "view_chat_image",
              args: { attachment_id: attachmentId },
            },
          },
        },
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: "tool_call",
        subtype: "completed",
        call_id: "image-tool",
        tool_call: {
          completedAtMs: "110",
          mcpToolCall: {
            result: {
              success: {
                isError: false,
                content: [
                  {
                    image: {
                      data: Buffer.from("distinctive-jpeg").toString("base64"),
                      mimeType: "image/jpeg",
                    },
                  },
                ],
              },
            },
          },
        },
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "I read the image." }] },
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({ type: "result", subtype: "success" })}\n`,
    );
    child.emit("close", 0);

    const result = await turn;
    const serialized = JSON.stringify({
      messages: result.messages,
      toolDetails: args.toolDetails,
    });
    expect(result.iterations).toBe(2);
    expect(
      args.toolDetails.filter((detail) => detail.name === "view_chat_image"),
    ).toEqual([
      expect.objectContaining({
        name: "view_chat_image",
        input: { attachment_id: attachmentId },
        status: "ok",
      }),
    ]);
    expect(serialized).not.toContain(
      Buffer.from("distinctive-jpeg").toString("base64"),
    );
    expect(
      result.messages.some((message) =>
        JSON.stringify(message.blocks).includes("view_chat_image"),
      ),
    ).toBe(false);
  });
});

// Issue #443 — thread Cursor's real terminal-event usage into the shared
// Usage totals instead of leaving them at all-zero.
describe("runCursorTurn usage extraction (issue #443)", () => {
  it("adds the real captured terminal usage event into args.usage", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const args = baseArgs({ iterations: 0 });

    const turn = runCursorTurn(args);
    await waitForSpawn();

    child.stdout.write(
      `${JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Hi there!" }] },
      })}\n`,
    );
    child.stdout.write(
      `${JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Hi there!",
        duration_ms: 6498,
        duration_api_ms: 6498,
        is_error: false,
        usage: {
          inputTokens: 2,
          outputTokens: 7,
          cacheReadTokens: 0,
          cacheWriteTokens: 30876,
        },
      })}\n`,
    );
    child.emit("close", 0);

    await turn;
    expect(args.usage).toEqual({
      input_tokens_total: 2,
      output_tokens_total: 7,
      cache_creation_input_tokens_total: 30876,
      cache_read_input_tokens_total: 0,
      calls: 1,
    });
  });

  it("leaves args.usage at zero when the terminal event carries no usage", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const args = baseArgs({ iterations: 0 });

    const turn = runCursorTurn(args);
    await waitForSpawn();

    child.stdout.write(
      `${JSON.stringify({ type: "result", subtype: "success", result: "ok" })}\n`,
    );
    child.emit("close", 0);

    await turn;
    expect(args.usage).toEqual({
      input_tokens_total: 0,
      output_tokens_total: 0,
      cache_creation_input_tokens_total: 0,
      cache_read_input_tokens_total: 0,
      calls: 0,
    });
  });
});

// An early-exit reject (stdio unavailable, a mid-stream tool-call cap
// breach, or a child `error`) only SIGTERMs the child — the real `close`
// event can still arrive later. spawn_to_early_exit_ms captures what was
// observed at reject time without corrupting spawn_to_process_close_ms,
// which scripts/BENCH.md reads as "the process actually closed".
describe("runCursorTurn early-exit timing", () => {
  it("records spawn_to_early_exit_ms (and leaves spawn_to_process_close_ms null) when child stdio is unavailable", async () => {
    const child = fakeChildWithoutStdio();
    spawnMock.mockReturnValue(child);
    const detailState: DetailState = { iterations: 0 };
    const args = baseArgs(detailState);

    await expect(runCursorTurn(args)).rejects.toThrow(
      "cursor-agent stdio unavailable",
    );

    expect(detailState.cursor?.timing.spawn_to_early_exit_ms).toEqual(
      expect.any(Number),
    );
    expect(detailState.cursor?.timing.spawn_to_process_close_ms).toBeNull();
  });

  it("records spawn_to_early_exit_ms when the child process emits an error", async () => {
    const child = fakeChild();
    spawnMock.mockReturnValue(child);
    const detailState: DetailState = { iterations: 0 };
    const args = baseArgs(detailState);

    const turn = runCursorTurn(args);
    await waitForSpawn();

    child.emit("error", new Error("ENOENT"));

    await expect(turn).rejects.toThrow();
    expect(detailState.cursor?.timing.spawn_to_early_exit_ms).toEqual(
      expect.any(Number),
    );
    expect(detailState.cursor?.timing.spawn_to_process_close_ms).toBeNull();
  });

  // The scenario the split field exists for: cap breach only SIGTERMs the
  // child, so `close` genuinely arrives afterward and must still record the
  // true close time — not be silently discarded by whatever the early-exit
  // reject captured.
  it("still records the true spawn_to_process_close_ms when close arrives after a mid-stream cap breach", async () => {
    const child = fakeChild(5_555);
    spawnMock.mockReturnValue(child);
    vi.spyOn(process, "kill").mockReturnValue(true);
    const detailState: DetailState = { iterations: 0 };
    const args = baseArgs(detailState);

    const turn = runCursorTurn(args);
    await waitForSpawn();
    vi.useFakeTimers();

    // MAX_CURSOR_TOOL_CALLS is 12: emit 13 started+completed pairs so the
    // cap-breach throw fires mid-stream, well before the process actually
    // exits.
    for (let i = 0; i < 13; i += 1) {
      const callId = `call-${i}`;
      child.stdout.write(
        `${JSON.stringify({
          type: "tool_call",
          subtype: "started",
          call_id: callId,
          tool_call: {
            startedAtMs: String(i * 10),
            mcpToolCall: { args: { toolName: "query_recovery", args: {} } },
          },
        })}\n`,
      );
      child.stdout.write(
        `${JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: callId,
          tool_call: {
            startedAtMs: String(i * 10),
            completedAtMs: String(i * 10 + 5),
            mcpToolCall: {
              result: { success: { isError: false, content: [{ text: { text: "{}" } }] } },
            },
          },
        })}\n`,
      );
    }

    await expect(turn).rejects.toThrow(/exceeded 12 tool calls/);

    const earlyExitMs = detailState.cursor?.timing.spawn_to_early_exit_ms;
    expect(earlyExitMs).toEqual(expect.any(Number));
    expect(detailState.cursor?.timing.spawn_to_process_close_ms).toBeNull();

    await vi.advanceTimersByTimeAsync(5_000);
    child.emit("close", null);

    expect(detailState.cursor?.timing.spawn_to_process_close_ms).toEqual(
      expect.any(Number),
    );
    expect(detailState.cursor?.timing.spawn_to_process_close_ms).toBeGreaterThan(
      earlyExitMs ?? 0,
    );
  });
});
