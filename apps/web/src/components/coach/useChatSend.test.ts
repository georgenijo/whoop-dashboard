import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoachWorkLog } from "@/lib/coach/work-log-types";
import { useChatSend, type ChatMessage } from "./useChatSend";

const emptyMessages: ChatMessage[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

function controllableStreamResponse() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  return {
    response: new Response(
      new ReadableStream({
        start(nextController) {
          controller = nextController;
        },
      }),
    ),
    send: (chunk: string) => controller.enqueue(encoder.encode(chunk)),
    close: () => controller.close(),
  };
}

function renderChat(initialMessages: ChatMessage[] = emptyMessages, threadId = 1) {
  return renderHook(
    ({ messages, id }: { messages: ChatMessage[]; id: number }) =>
      useChatSend({
        initialMessages: messages,
        threadId: id,
        setThreadId: vi.fn(),
        refreshThreads: vi.fn(async () => []),
      }),
    { initialProps: { messages: initialMessages, id: threadId } },
  );
}

describe("useChatSend work logs", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a running work log immediately and applies the authoritative done log", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
    const { result } = renderChat();

    let sendPromise = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("hey");
    });

    await waitFor(() => {
      expect(result.current.messages[1]).toMatchObject({
        role: "assistant",
        content: "",
        streaming: true,
        workLog: {
          version: 1,
          status: "running",
          notes: [],
          tools: [],
        },
      });
    });

    const authoritative: CoachWorkLog = {
      version: 1,
      status: "complete",
      duration_ms: 84,
      notes: [],
      tools: [],
    };
    await act(async () => {
      pending.resolve(
        streamResponse([
          sse("text_delta", { text: "Hello" }),
          sse("done", { reply: "Hello there.", work_log: authoritative }),
        ]),
      );
      await sendPromise;
    });

    expect(result.current.messages[1]).toMatchObject({
      content: "Hello there.",
      streaming: false,
      workLog: authoritative,
    });
  });

  it("moves pre-tool text into notes and accumulates sequential and parallel tools by id", async () => {
    const pending = deferred<Response>();
    const stream = controllableStreamResponse();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
    const { result } = renderChat();

    act(() => {
      void result.current.send("Compare this month");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    await act(async () => pending.resolve(stream.response));

    act(() => {
      stream.send(sse("text_delta", { text: "I’ll compare the periods." }));
      stream.send(
        sse("tool_use_start", {
          id: "recovery-current",
          name: "query_recovery",
          input: { start_date: "2026-07-01" },
        }),
      );
      stream.send(
        sse("tool_use_start", {
          id: "recovery-previous",
          name: "query_recovery",
          input: { start_date: "2026-06-01" },
        }),
      );
      stream.send(
        sse("tool_progress", {
          id: "recovery-previous",
          tool: "query_recovery",
          stage: "reading_rows",
        }),
      );
      stream.send(
        sse("tool_use_end", {
          id: "recovery-current",
          name: "query_recovery",
          duration_ms: 40,
          rows: 20,
          status: "ok",
          response: [{ recovery_score: 70 }],
        }),
      );
      stream.send(
        sse("tool_use_end", {
          id: "recovery-previous",
          name: "query_recovery",
          duration_ms: 55,
          rows: 22,
          status: "ok",
          response: [{ recovery_score: 66 }],
        }),
      );
    });

    await waitFor(() => {
      const assistant = result.current.messages[1];
      expect(assistant.content).toBe("");
      expect(assistant.workLog?.notes).toEqual(["I’ll compare the periods."]);
      expect(assistant.workLog?.tools.map((tool) => tool.id)).toEqual([
        "recovery-current",
        "recovery-previous",
      ]);
      expect(assistant.workLog?.tools[0]).toMatchObject({
        state: "complete",
        rows: 20,
      });
      expect(assistant.workLog?.tools[1]).toMatchObject({
        state: "complete",
        stage: "reading_rows",
        rows: 22,
      });
      expect(result.current.progressLabel).toBe("Analyzing results…");
    });

    act(() => {
      stream.send(sse("text_delta", { text: "Your recovery improved." }));
    });
    await waitFor(() => {
      expect(result.current.messages[1].content).toBe("Your recovery improved.");
      expect(result.current.messages[1].workLog?.tools).toHaveLength(2);
    });
    act(() => stream.close());
  });

  it("keeps accumulated tools and marks the receipt error when transport fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          streamResponse([
            sse("tool_use_start", {
              id: "failed-call",
              name: "query_sleep",
              input: {},
            }),
          ]),
        ),
      ),
    );
    const { result } = renderChat();

    await act(async () => {
      await result.current.send("sleep");
    });

    expect(result.current.messages[1]).toMatchObject({
      content: "**Error:** Connection lost before Coach finished.",
      streaming: false,
      workLog: {
        status: "error",
        tools: [{ id: "failed-call", state: "running" }],
      },
    });
  });

  it("drops a stale in-flight turn when switching threads and restores persisted logs", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
    const { result, rerender } = renderChat();
    act(() => {
      void result.current.send("old request");
    });
    await waitFor(() => expect(result.current.loading).toBe(true));

    const persisted: CoachWorkLog = {
      version: 1,
      status: "complete",
      duration_ms: 1200,
      notes: ["Checked your sleep."],
      tools: [],
    };
    rerender({
      id: 2,
      messages: [
        {
          id: 9,
          role: "assistant",
          content: "New thread",
          created_at: "2026-07-30T00:00:00Z",
          work_log: persisted,
        },
      ],
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.messages).toEqual([
        {
          role: "assistant",
          content: "New thread",
          status: undefined,
          workLog: persisted,
        },
      ]);
    });
  });
});
