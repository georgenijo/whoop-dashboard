// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  getUserSettings: vi.fn(() => ({
    coach_goals: null,
    system_prompt: null,
  })),
}));
vi.mock("@/lib/db/connection", () => ({
  dbPath: vi.fn(() => "/tmp/test-whoop.db"),
}));
vi.mock("./prompts", () => ({
  buildCursorSystemPrompt: vi.fn(() => "System prompt"),
}));
vi.mock("./cursor-key", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cursor-key")>();
  return {
    ...actual,
    resolveCursorKey: vi.fn(() => ({ key: "key", origin: "user" })),
  };
});
vi.mock("./tools", () => ({
  captureToolResponse: vi.fn((value: unknown) => value),
  redactToolPayload: vi.fn((value: unknown) => value),
  newToolTurnState: vi.fn(() => ({
    syncAttempts: 0,
    savedPlanHashes: new Map(),
  })),
  executeTool: vi.fn(),
}));

const runtime = vi.hoisted(() => ({
  hasPrompted: false,
  historyFingerprint: null,
  diagnostics: {
    protocolVersion: 1,
    agentName: "fake-cursor",
    agentVersion: "1.0",
    sessionId: "session-1",
    requestedModel: "gpt-5.6-luna",
    resolvedModel: "gpt-5.6-luna",
    appliedParameters: [{ id: "reasoning", value: "low" }],
    stderr: "",
    process: {
      exitCode: null,
      signal: null,
      cancelled: false,
      timedOut: false,
    },
    timing: {
      spawnMs: 1,
      initializeMs: 2,
      authenticateMs: 1,
      sessionMs: 2,
      modelConfigMs: 1,
      firstEventMs: 3,
      promptMs: 10,
    },
  },
  prepareTurn: vi.fn(async () => {}),
  applyModel: vi.fn(async () => {}),
  cancelActiveTurn: vi.fn(async () => {}),
  usageDelta: vi.fn(() => ({
    totalTokens: 15,
    inputTokens: 10,
    outputTokens: 5,
    cachedReadTokens: 2,
    cachedWriteTokens: 1,
  })),
  prompt: vi.fn(async (_text, _signal, onUpdate) => {
    onUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "Query recovery",
        status: "in_progress",
        rawInput: { start_date: "2026-08-18", end_date: "2026-08-18" },
      },
    });
    onUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: {
          content: [
            { type: "text", text: JSON.stringify([{ recovery_score: 81 }]) },
          ],
          isError: false,
        },
      },
    });
    onUpdate({
      sessionId: "session-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Recovery is 81%." },
      },
    });
    runtime.hasPrompted = true;
    return { stopReason: "end_turn", usage: {} };
  }),
}));

vi.mock("./cursor-acp-registry", () => ({
  cursorCredentialFingerprint: vi.fn(() => "credential"),
  cursorPromptFingerprint: vi.fn(() => "prompt"),
  cursorAcpSessions: {
    run: vi.fn(async (_input, operation) => operation(runtime)),
  },
}));

import { runCursorAcpTurn } from "./cursor-acp-turn";

describe("runCursorAcpTurn", () => {
  beforeEach(() => {
    runtime.hasPrompted = false;
    runtime.prepareTurn.mockClear();
    runtime.applyModel.mockClear();
    runtime.cancelActiveTurn.mockClear();
    runtime.prompt.mockClear();
  });

  it("normalizes ACP text, tools, usage, and diagnostics into Coach contracts", async () => {
    const toolDetails: never[] = [];
    const usage = {
      input_tokens_total: 0,
      output_tokens_total: 0,
      cache_creation_input_tokens_total: 0,
      cache_read_input_tokens_total: 0,
      calls: 0,
    };
    const detailState = { iterations: 0 };
    const onTextDelta = vi.fn();
    const onToolUseStart = vi.fn();
    const onToolUseEnd = vi.fn();

    const result = await runCursorAcpTurn({
      userId: 7,
      threadId: 150,
      model: "gpt-5.6-luna",
      modelParameters: [{ id: "reasoning", value: "low" }],
      turn: {
        displayText: "USE_TOOL",
        modelText: "USE_TOOL",
        images: [],
      },
      conversation: [],
      toolDetails,
      usage,
      detailState,
      options: { onTextDelta, onToolUseStart, onToolUseEnd },
    });

    expect(result.reply).toBe("Recovery is 81%.");
    expect(result.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(onTextDelta).toHaveBeenCalledWith("Recovery is 81%.");
    expect(onToolUseStart).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "query_recovery",
      }),
    );
    expect(onToolUseEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "query_recovery",
        rows: 1,
        status: "ok",
      }),
    );
    expect(usage).toEqual({
      input_tokens_total: 10,
      output_tokens_total: 5,
      cache_creation_input_tokens_total: 1,
      cache_read_input_tokens_total: 2,
      calls: 1,
    });
    expect(detailState).toMatchObject({
      iterations: 2,
      cursor: {
        transport: "acp",
        resolved_model: "gpt-5.6-luna",
        attempted_tool_calls: 1,
        acp: { session_id: "session-1" },
      },
    });
  });

  it("rejects a provider refusal", async () => {
    runtime.prompt.mockResolvedValueOnce({ stopReason: "refusal", usage: {} });

    await expect(
      runCursorAcpTurn({
        userId: 7,
        threadId: 150,
        model: "gpt-5.6-luna",
        turn: { displayText: "No", modelText: "No", images: [] },
        conversation: [],
        toolDetails: [],
        usage: {
          input_tokens_total: 0,
          output_tokens_total: 0,
          cache_creation_input_tokens_total: 0,
          cache_read_input_tokens_total: 0,
          calls: 0,
        },
        detailState: { iterations: 0 },
        options: {},
      }),
    ).rejects.toThrow("Cursor refused the request");
  });

  it("honors an already-aborted turn before invoking the runtime", async () => {
    const signal = AbortSignal.abort(new Error("already aborted"));

    await expect(
      runCursorAcpTurn({
        userId: 7,
        threadId: 150,
        model: "gpt-5.6-luna",
        turn: { displayText: "Stop", modelText: "Stop", images: [] },
        conversation: [],
        toolDetails: [],
        usage: {
          input_tokens_total: 0,
          output_tokens_total: 0,
          cache_creation_input_tokens_total: 0,
          cache_read_input_tokens_total: 0,
          calls: 0,
        },
        detailState: { iterations: 0 },
        options: { signal },
      }),
    ).rejects.toThrow("already aborted");
    expect(runtime.prompt).not.toHaveBeenCalled();
  });

  it("cancels and fails on a thirteenth tool completion", async () => {
    runtime.prompt.mockImplementationOnce(async (_text, _signal, onUpdate) => {
      for (let index = 0; index < 13; index += 1) {
        onUpdate({
          sessionId: "session-1",
          update: {
            sessionUpdate: "tool_call",
            toolCallId: `tool-${index}`,
            title: "Query recovery",
            status: "completed",
            rawInput: {},
            rawOutput: { content: [{ type: "text", text: "[]" }] },
          },
        });
      }
      return { stopReason: "end_turn", usage: {} };
    });

    await expect(
      runCursorAcpTurn({
        userId: 7,
        threadId: 150,
        model: "gpt-5.6-luna",
        turn: { displayText: "Tools", modelText: "Tools", images: [] },
        conversation: [],
        toolDetails: [],
        usage: {
          input_tokens_total: 0,
          output_tokens_total: 0,
          cache_creation_input_tokens_total: 0,
          cache_read_input_tokens_total: 0,
          calls: 0,
        },
        detailState: { iterations: 0 },
        options: {},
      }),
    ).rejects.toThrow("exceeded 12 tool calls");
    expect(runtime.cancelActiveTurn).toHaveBeenCalledOnce();
  });

  it("closes a started tool event when the prompt stops early", async () => {
    runtime.prompt.mockImplementationOnce(async (_text, _signal, onUpdate) => {
      onUpdate({
        sessionId: "session-1",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "pending-tool",
          title: "Query recovery",
          status: "in_progress",
          rawInput: {},
        },
      });
      return { stopReason: "max_tokens", usage: {} };
    });
    const onToolUseEnd = vi.fn();
    const toolDetails: never[] = [];

    await runCursorAcpTurn({
      userId: 7,
      threadId: 150,
      model: "gpt-5.6-luna",
      turn: { displayText: "Tools", modelText: "Tools", images: [] },
      conversation: [],
      toolDetails,
      usage: {
        input_tokens_total: 0,
        output_tokens_total: 0,
        cache_creation_input_tokens_total: 0,
        cache_read_input_tokens_total: 0,
        calls: 0,
      },
      detailState: { iterations: 0 },
      options: { onToolUseEnd },
    });

    expect(onToolUseEnd).toHaveBeenCalledWith(
      expect.objectContaining({ id: "pending-tool", status: "error" }),
    );
    expect(toolDetails).toHaveLength(1);
  });
});
