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
          attachments: [],
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
          attachments: [],
        },
      ]);
    });
  });
});

describe("useChatSend image attachments", () => {
  const createObjectUrl = vi.fn<(file: Blob) => string>();
  const revokeObjectUrl = vi.fn<(url: string) => void>();

  beforeEach(() => {
    vi.unstubAllGlobals();
    createObjectUrl.mockReset();
    revokeObjectUrl.mockReset();
    createObjectUrl.mockImplementation(
      () => `blob:preview-${createObjectUrl.mock.calls.length}`,
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      },
    );
  });

  it("sends image-only multipart, refreshes persisted attachments, and releases previews", async () => {
    const pendingResponse = deferred<Response>();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => pendingResponse.promise)
      .mockResolvedValueOnce(
        Response.json([
          {
            id: 11,
            role: "user",
            content: "",
            created_at: "2026-07-30T00:00:00Z",
            status: "complete",
            work_log: null,
            attachments: [
              {
                id: "stored-image",
                url: "/api/chat/attachments/stored-image",
                mime_type: "image/jpeg",
                width: 800,
                height: 600,
                size_bytes: 120_000,
              },
            ],
          },
          {
            id: 12,
            role: "assistant",
            content: "A visible label.",
            created_at: "2026-07-30T00:00:01Z",
            status: "complete",
            work_log: null,
            attachments: [],
          },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderChat();
    const file = new File(["jpeg"], "meal.jpg", { type: "image/jpeg" });

    act(() => result.current.addImages([file]));
    await waitFor(() => expect(result.current.pendingImages).toHaveLength(1));

    let sendPromise = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("");
    });
    await waitFor(() => {
      expect(result.current.messages[0].attachments).toEqual([
        expect.objectContaining({
          url: "blob:preview-1",
          pending: true,
        }),
      ]);
      expect(result.current.preparingImages).toBe(true);
    });

    await act(async () => {
      pendingResponse.resolve(
        new Response(
          streamResponse([
            sse("text_delta", { text: "A visible label." }),
            sse("done", { reply: "A visible label.", work_log: null }),
          ]).body,
          { headers: { "x-thread-id": "7" } },
        ),
      );
      await sendPromise;
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = request.body as FormData;
    expect(request.headers).toBeUndefined();
    expect(body.get("message")).toBe("");
    expect(body.get("thread_id")).toBe("1");
    expect(body.get("days")).toBe("9999");
    expect(body.getAll("images")).toEqual([file]);
    expect(result.current.pendingImages).toEqual([]);
    expect(result.current.input).toBe("");
    expect(result.current.messages[0].attachments).toEqual([
      expect.objectContaining({
        id: "stored-image",
        url: "/api/chat/attachments/stored-image",
      }),
    ]);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:preview-1");
  });

  it("restores the exact text and selected files after a provider stream failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          sse("error", {
            message: "The selected Coach provider rejected the request.",
          }),
        ]),
      ),
    );
    const { result } = renderChat();
    const file = new File(["png"], "injury.png", { type: "image/png" });

    act(() => {
      result.current.setInput("What do you notice?");
      result.current.addImages([file]);
    });
    await waitFor(() => expect(result.current.pendingImages).toHaveLength(1));

    await act(async () => {
      await result.current.send("What do you notice?");
    });

    expect(result.current.input).toBe("What do you notice?");
    expect(result.current.pendingImages[0].file).toBe(file);
    expect(result.current.messages.at(-1)?.content).toContain(
      "selected Coach provider rejected",
    );
    expect(revokeObjectUrl).not.toHaveBeenCalled();
  });

  it("enforces the selection limit and releases URLs on remove, thread switch, and unmount", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
    const { result, rerender, unmount } = renderChat();
    const files = [1, 2, 3, 4].map(
      (index) =>
        new File([String(index)], `${index}.jpg`, { type: "image/jpeg" }),
    );

    act(() => result.current.addImages(files));
    expect(result.current.pendingImages).toEqual([]);
    expect(result.current.attachmentError).toBe(
      "You can attach up to 3 images.",
    );

    act(() => result.current.addImages([files[0]]));
    await waitFor(() => expect(result.current.pendingImages).toHaveLength(1));
    const firstId = result.current.pendingImages[0].id;
    act(() => result.current.removeImage(firstId));
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:preview-1");

    act(() => result.current.addImages([files[1]]));
    await waitFor(() => expect(result.current.pendingImages).toHaveLength(1));
    rerender({ id: 2, messages: [] });
    await waitFor(() => expect(result.current.pendingImages).toEqual([]));
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:preview-2");

    act(() => result.current.addImages([files[2]]));
    await waitFor(() => expect(result.current.pendingImages).toHaveLength(1));
    unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:preview-3");
  });
});
