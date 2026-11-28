import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoachWorkLog } from "@/lib/coach/work-log-types";
import { useChatSend, type ChatMessage } from "./useChatSend";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

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

describe("useChatSend router cache", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    router.refresh.mockReset();
  });

  it("refreshes the router once after a completed turn, not before", async () => {
    const stream = controllableStreamResponse();
    vi.stubGlobal("fetch", vi.fn(async () => stream.response));
    const { result } = renderChat();

    let sendPromise = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("hey");
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(router.refresh).not.toHaveBeenCalled();

    stream.send(sse("done", { reply: "Hi", work_log: null }));
    stream.close();
    await act(async () => {
      await sendPromise;
    });

    expect(router.refresh).toHaveBeenCalledOnce();
    expect(result.current.messages[1]).toMatchObject({ content: "Hi" });
  });

  it("refreshes the router after a failed turn", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const { result } = renderChat();

    await act(async () => {
      await result.current.send("hey");
    });

    expect(router.refresh).toHaveBeenCalledOnce();
    expect(result.current.messages[1].error?.detail).toBe("boom");
  });

  it("does not refresh when nothing was sent", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { result } = renderChat();

    await act(async () => {
      await result.current.send("   ");
    });

    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("keeps live state when the refresh hands back new same-thread initialMessages", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([sse("done", { reply: "Hi", work_log: null })])));
    const { result, rerender } = renderChat();

    await act(async () => {
      await result.current.send("hey");
    });
    act(() => result.current.setInput("follow-up draft"));

    // What router.refresh() delivers: same thread, fresh array identity.
    rerender({
      id: 1,
      messages: [
        { id: 1, role: "user", content: "hey", created_at: "2026-07-30T00:00:00Z", attachments: [] },
        { id: 2, role: "assistant", content: "Hi", created_at: "2026-07-30T00:00:01Z", attachments: [] },
      ],
    });

    expect(result.current.input).toBe("follow-up draft");
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({ content: "Hi" });
  });
});

describe("useChatSend work logs", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    router.refresh.mockReset();
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

  it("preserves a follow-up draft while the active reply streams", async () => {
    const pending = deferred<Response>();
    const stream = controllableStreamResponse();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
    const { result } = renderChat();

    act(() => {
      result.current.setInput("First question");
    });
    let sendPromise = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("First question");
    });

    expect(result.current.input).toBe("");
    expect(result.current.loading).toBe(true);

    act(() => {
      result.current.setInput("Follow-up draft");
    });
    await act(async () => pending.resolve(stream.response));
    expect(result.current.input).toBe("Follow-up draft");

    act(() => {
      stream.send(sse("done", { reply: "First answer", work_log: null }));
      stream.close();
    });
    await act(async () => sendPromise);

    expect(result.current.input).toBe("Follow-up draft");
  });

  it("does not overwrite a follow-up draft when the active reply fails", async () => {
    const pending = deferred<Response>();
    const stream = controllableStreamResponse();
    vi.stubGlobal("fetch", vi.fn(() => pending.promise));
    const { result } = renderChat();

    act(() => {
      result.current.setInput("First question");
    });
    let sendPromise = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("First question");
    });
    await act(async () => pending.resolve(stream.response));

    act(() => {
      result.current.setInput("Keep this follow-up");
      stream.send(sse("error", { message: "Provider unavailable." }));
      stream.close();
    });
    await act(async () => sendPromise);

    expect(result.current.input).toBe("Keep this follow-up");
    expect(result.current.messages.at(-1)?.error?.detail).toBe(
      "Provider unavailable.",
    );
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
      content: "",
      error: { errorClass: "network", detail: null, uncertain: true },
      streaming: false,
      workLog: {
        status: "error",
        tools: [{ id: "failed-call", state: "running" }],
      },
    });
  });

  it("drops a stale in-flight turn when switching threads and loads the new thread client-side", async () => {
    const pending = deferred<Response>();
    const persisted: CoachWorkLog = {
      version: 1,
      status: "complete",
      duration_ms: 1200,
      notes: ["Checked your sleep."],
      tools: [],
    };
    const fetchMock = vi.fn((url: string) =>
      String(url) === "/api/chat/history?thread_id=2&include=context"
        ? Promise.resolve(
            Response.json([
              {
                id: 9,
                role: "assistant",
                content: "New thread",
                created_at: "2026-07-30T00:00:00Z",
                work_log: persisted,
                attachments: [],
              },
            ]),
          )
        : pending.promise,
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderChat();
    act(() => {
      void result.current.send("old request");
    });
    await waitFor(() => expect(result.current.loading).toBe(true));

    // Only the thread id changes: no server-rendered `initialMessages` arrive.
    rerender({ id: 2, messages: emptyMessages });
    expect(result.current.threadLoad).toBe("loading");

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.threadLoad).toBe("idle");
      expect(result.current.messages).toEqual([
        {
          clientId: "m:9",
          role: "assistant",
          content: "New thread",
          status: undefined,
          workLog: persisted,
          attachments: [],
        },
      ]);
    });
  });

  it("paints a previously visited thread from cache, then revalidates it", async () => {
    const history = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        String(url).startsWith("/api/chat/history?thread_id=2")
          ? Promise.resolve(Response.json([]))
          : history.promise,
      ),
    );
    const first: ChatMessage[] = [
      { id: 1, role: "user", content: "thread one", created_at: "2026-07-30T00:00:00Z", attachments: [] },
    ];
    const { result, rerender } = renderChat(first, 1);
    rerender({ id: 2, messages: emptyMessages });
    await waitFor(() => expect(result.current.threadLoad).toBe("idle"));

    // Back to thread 1: shown immediately from cache while history reloads.
    rerender({ id: 1, messages: emptyMessages });
    expect(result.current.messages.map((m) => m.content)).toEqual(["thread one"]);
    expect(result.current.threadLoad).toBe("idle");
    history.resolve(Response.json(first));
    await waitFor(() => expect(result.current.messages[0]?.clientId).toBe("m:1"));
  });

  it("waits for the selected thread to load before sending", async () => {
    const history = deferred<Response>();
    const fetchMock = vi.fn((url: string) =>
      String(url).startsWith("/api/chat/history") ? history.promise : Promise.reject(new Error("no")),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderChat();
    rerender({ id: 2, messages: emptyMessages });

    await act(async () => {
      await result.current.send("too early");
    });

    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/chat")).toHaveLength(0);
    history.resolve(Response.json([]));
    await waitFor(() => expect(result.current.threadLoad).toBe("idle"));
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
    expect(result.current.messages.at(-1)?.error?.detail).toContain(
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

// Routes Coach POSTs to `posts` in order and history GETs to `history`.
function chatFetch(posts: Response[], history: () => unknown[] = () => []) {
  const queue = [...posts];
  return vi.fn(async (url: string, init?: RequestInit) => {
    void init;
    if (String(url).startsWith("/api/chat/history")) return Response.json(history());
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request to ${url}`);
    return next;
  });
}

function postBodies(fetchMock: ReturnType<typeof chatFetch>) {
  return fetchMock.mock.calls
    .filter(([url]) => url === "/api/chat")
    .map(([, init]) => JSON.parse(String(init?.body)));
}

describe("useChatSend stop and retry", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    router.refresh.mockReset();
  });

  it("stops a streaming reply and keeps the text it already received", async () => {
    let signal: AbortSignal | undefined;
    const stream = controllableStreamResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        signal?.addEventListener("abort", () => {
          // Real fetch bodies error with the abort reason once aborted.
          try {
            stream.close();
          } catch {}
        });
        return stream.response;
      }),
    );
    const { result } = renderChat();

    let sendPromise = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("long question");
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    act(() => stream.send(sse("text_delta", { text: "Partial answer" })));
    await waitFor(() =>
      expect(result.current.messages.at(-1)?.content).toBe("Partial answer"),
    );

    act(() => result.current.stop());
    await act(async () => {
      await sendPromise;
    });

    expect(signal?.aborted).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: "user",
      content: "long question",
    });
    expect(result.current.messages[1]).toMatchObject({
      role: "assistant",
      content: "Partial answer",
      streaming: false,
      status: "aborted",
      workLog: expect.objectContaining({ status: "aborted" }),
    });
    expect(result.current.messages[1].error).toBeUndefined();
  });

  it.each([
    [{ status: 503, body: { error: "No Anthropic API key configured.", reason: "missing_key" } }, "missing_key"],
    [{ status: 502, body: { error: "The server's key was rejected.", kind: "upstream_error", reason: "invalid_key" } }, "invalid_key"],
    [{ status: 422, body: { error: "Model retired.", kind: "upstream_error", reason: "model_unavailable" } }, "model_unavailable"],
    [{ status: 503, body: { error: "Overloaded.", kind: "overloaded", reason: "overloaded" } }, "overloaded"],
    [{ status: 504, body: { error: "Took too long.", kind: "upstream_error", reason: "timeout" } }, "timeout"],
    [{ status: 500, body: { error: "Coach call failed. Please try again.", kind: "server_error" } }, "unknown"],
  ])("classifies a %j response as %s", async ({ status, body }, errorClass) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { status })));
    const { result } = renderChat();

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.messages.at(-1)?.error?.errorClass).toBe(errorClass);
    expect(result.current.messages.at(-1)?.content).not.toMatch(/Error:/);
  });

  it("classifies stream error events by their reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          sse("text_delta", { text: "Half" }),
          sse("error", { kind: "upstream_error", reason: "timeout", message: "The Cursor coach took too long. Try again." }),
        ]),
      ),
    );
    const { result } = renderChat();

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.messages.at(-1)).toMatchObject({
      content: "Half",
      streaming: false,
      error: {
        errorClass: "timeout",
        detail: "The Cursor coach took too long. Try again.",
      },
    });
  });

  it("classifies a dropped stream as a lost connection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([sse("text_delta", { text: "Half" })])),
    );
    const { result } = renderChat();

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.messages.at(-1)?.error).toEqual({
      errorClass: "network",
      detail: null,
      uncertain: true,
    });
  });

  it("classifies a cancelled request that the user did not stop", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The user aborted a request.", "AbortError");
      }),
    );
    const { result } = renderChat();

    await act(async () => {
      await result.current.send("hi");
    });

    expect(result.current.messages.at(-1)?.error?.errorClass).toBe("cancelled");
  });

  it("retries the failed message without duplicating it in the thread", async () => {
    const fetchMock = chatFetch([
      Response.json(
        { error: "Overloaded.", kind: "overloaded", reason: "overloaded" },
        { status: 503 },
      ),
      streamResponse([
        sse("text_delta", { text: "Recovered" }),
        sse("done", { reply: "Recovered" }),
      ]),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderChat([
      {
        id: 1,
        role: "user",
        content: "earlier",
        created_at: "2026-11-27T10:00:00.000Z",
        attachments: [],
      },
      {
        id: 2,
        role: "assistant",
        content: "earlier reply",
        created_at: "2026-11-27T10:00:01.000Z",
        attachments: [],
      },
    ]);

    await act(async () => {
      await result.current.send("how did I sleep?");
    });
    expect(result.current.messages).toHaveLength(4);
    expect(result.current.messages.at(-1)?.error?.errorClass).toBe("overloaded");
    // The failure restores the draft so it can be edited instead.
    expect(result.current.input).toBe("how did I sleep?");

    await act(async () => {
      await result.current.retry();
    });

    const bodies = postBodies(fetchMock);
    expect(bodies).toHaveLength(2);
    expect(bodies[1].messages).toEqual([
      { role: "user", content: "how did I sleep?" },
    ]);
    expect(
      result.current.messages.map(({ role, content }) => ({ role, content })),
    ).toEqual([
      { role: "user", content: "earlier" },
      { role: "assistant", content: "earlier reply" },
      { role: "user", content: "how did I sleep?" },
      { role: "assistant", content: "Recovered" },
    ]);
    expect(result.current.messages.at(-1)?.error).toBeUndefined();
    expect(result.current.input).toBe("");
  });

  it("keeps an edited draft when retrying", async () => {
    vi.stubGlobal(
      "fetch",
      chatFetch([
        Response.json({ error: "Busy", kind: "overloaded" }, { status: 503 }),
        streamResponse([sse("done", { reply: "ok" })]),
      ]),
    );
    const { result } = renderChat();

    await act(async () => {
      await result.current.send("first");
    });
    act(() => result.current.setInput("something else"));
    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.input).toBe("something else");
    expect(result.current.messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  it("does nothing when the last reply did not fail", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderChat([
      {
        id: 1,
        role: "user",
        content: "q",
        created_at: "2026-11-27T10:00:00.000Z",
        attachments: [],
      },
      {
        id: 2,
        role: "assistant",
        content: "a",
        created_at: "2026-11-27T10:00:01.000Z",
        attachments: [],
      },
    ]);

    await act(async () => {
      await result.current.retry();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(2);
  });
});

describe("useChatSend failed turns", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("replaces a failed turn when the restored draft is sent again", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ error: "Busy", kind: "overloaded" }, { status: 503 }))
        .mockResolvedValueOnce(streamResponse([sse("done", { reply: "ok" })])),
    );
    const { result } = renderChat();

    await act(async () => {
      await result.current.send("first");
    });
    await act(async () => {
      await result.current.send(result.current.input);
    });

    expect(
      result.current.messages.map(({ role, content }) => ({ role, content })),
    ).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "ok" },
    ]);
  });
});

function stubObjectUrls() {
  let n = 0;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => `blob:test-${++n}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
}

describe("useChatSend review follow-ups", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("does not resend a turn the server already committed when done was lost", async () => {
    const fetchMock = chatFetch(
      [streamResponse([sse("text_delta", { text: "Your sleep" })])],
      () => [
        { id: 10, role: "user", content: "how did I sleep?", created_at: "2026-11-27T10:00:00.000Z", attachments: [] },
        { id: 11, role: "assistant", content: "Your sleep was solid.", created_at: "2026-11-27T10:00:05.000Z", attachments: [] },
      ],
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderChat();

    await act(async () => {
      await result.current.send("how did I sleep?");
    });
    expect(result.current.messages.at(-1)?.error?.errorClass).toBe("network");

    await act(async () => {
      await result.current.retry();
    });

    expect(postBodies(fetchMock)).toHaveLength(1);
    expect(result.current.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "how did I sleep?" },
      { role: "assistant", content: "Your sleep was solid." },
    ]);
    expect(result.current.input).toBe("");
  });

  it("shows a turn stored as interrupted without storing the prompt twice", async () => {
    const fetchMock = chatFetch(
      [streamResponse([sse("text_delta", { text: "Half" })])],
      () => [
        { id: 10, role: "user", content: "q", created_at: "2026-11-27T10:00:00.000Z", attachments: [] },
        { id: 11, role: "assistant", content: "Half", status: "aborted", created_at: "2026-11-27T10:00:05.000Z", attachments: [] },
      ],
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderChat();

    await act(async () => {
      await result.current.send("q");
    });
    await act(async () => {
      await result.current.retry();
    });

    expect(postBodies(fetchMock)).toHaveLength(1);
    expect(result.current.messages.map(({ role, content, status }) => ({ role, content, status }))).toEqual([
      { role: "user", content: "q", status: undefined },
      { role: "assistant", content: "Half", status: "aborted" },
    ]);
    expect(result.current.messages.at(-1)?.error?.retryable).toBe(false);
    // And Retry is now a no-op.
    await act(async () => {
      await result.current.retry();
    });
    expect(postBodies(fetchMock)).toHaveLength(1);
  });

  it("does not resend when history can't be checked, and keeps Retry available", async () => {
    let historyOk = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/chat/history")) {
        return historyOk ? Response.json([]) : new Response("down", { status: 503 });
      }
      return postBodiesQueue.shift()!;
    });
    const postBodiesQueue = [
      streamResponse([sse("text_delta", { text: "Half" })]),
      streamResponse([sse("done", { reply: "ok" })]),
    ];
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderChat();

    await act(async () => {
      await result.current.send("q");
    });
    await act(async () => {
      await result.current.retry();
    });
    const posts = () => fetchMock.mock.calls.filter(([url]) => url === "/api/chat").length;
    expect(posts()).toBe(1);
    expect(result.current.messages.at(-1)?.error?.detail).toMatch(/wasn't resent/);

    historyOk = true;
    await act(async () => {
      await result.current.retry();
    });
    expect(posts()).toBe(2);
    expect(result.current.messages.at(-1)?.content).toBe("ok");
  });

  it("abandons a Retry whose history check is overtaken by a new Send", async () => {
    const history = deferred<Response>();
    const posts: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).startsWith("/api/chat/history")) return history.promise;
        posts.push(JSON.parse(String(init?.body)).messages[0].content);
        return posts.length === 1
          ? streamResponse([sse("text_delta", { text: "cut off" })])
          : streamResponse([sse("done", { reply: "newer reply" })]);
      }),
    );
    const { result } = renderChat();
    await act(async () => {
      await result.current.send("old");
    });

    let retryPromise = Promise.resolve();
    act(() => {
      retryPromise = result.current.retry();
    });
    await act(async () => {
      await result.current.send("new question");
    });
    history.resolve(Response.json([]));
    await act(async () => retryPromise);

    expect(posts).toEqual(["old", "new question"]);
    expect(result.current.messages.at(-1)?.content).toBe("newer reply");
  });

  it("never resends from a Retry whose history check finishes after unmount", async () => {
    const history = deferred<Response>();
    const fetchMock = chatFetch([
      Response.json({ error: "Busy", kind: "overloaded" }, { status: 503 }),
    ]);
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("/api/chat/history")) return history.promise;
      return streamResponse([sse("text_delta", { text: "cut off" })]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result, unmount } = renderChat();
    await act(async () => {
      await result.current.send("q");
    });
    let retryPromise = Promise.resolve();
    act(() => {
      retryPromise = result.current.retry();
    });

    unmount();
    history.resolve(Response.json([]));
    await retryPromise;

    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/chat")).toHaveLength(1);
  });

  it.each([
    ["HTTP", () => Response.json({ error: "Your Anthropic API key was rejected. Update it in Settings.", kind: "bad_api_key", reason: "invalid_key", origin: "user" }, { status: 401 })],
    ["SSE", () => streamResponse([sse("error", { kind: "bad_api_key", reason: "invalid_key", origin: "user", message: "Your Anthropic API key was rejected. Update it in Settings." })])],
  ])("routes a %s bad_api_key through the failed-turn path with Retry", async (_label, failure) => {
    const setBadApiKey = vi.fn();
    const fetchMock = chatFetch([failure(), streamResponse([sse("done", { reply: "ok" })])]);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() =>
      useChatSend({
        initialMessages: [],
        threadId: 1,
        setThreadId: vi.fn(),
        refreshThreads: vi.fn(async () => []),
        setBadApiKey,
      }),
    );

    await act(async () => {
      await result.current.send("hi");
    });
    expect(setBadApiKey).toHaveBeenLastCalledWith(true);
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].error?.errorClass).toBe("invalid_key");
    expect(result.current.input).toBe("hi");

    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.messages.filter((m) => m.role === "user")).toHaveLength(1);
    expect(result.current.messages.at(-1)?.content).toBe("ok");
  });

  it("aborts the in-flight reply on unmount", async () => {
    let signal: AbortSignal | undefined;
    const stream = controllableStreamResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return stream.response;
      }),
    );
    const { result, unmount } = renderChat();
    act(() => {
      void result.current.send("hi");
    });
    await waitFor(() => expect(signal).toBeDefined());

    unmount();

    expect(signal?.aborted).toBe(true);
  });

  it("ends the stoppable phase on done, and shows Send busy while images save", async () => {
    stubObjectUrls();
    const stream = controllableStreamResponse();
    const history = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).startsWith("/api/chat/history") ? history.promise : stream.response,
      ),
    );
    const { result } = renderChat();
    act(() => result.current.addImages([new File(["x"], "a.jpg", { type: "image/jpeg" })]));

    let sendPromise = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("look");
    });
    await waitFor(() => expect(result.current.loading).toBe(true));
    act(() => {
      stream.send(sse("done", { reply: "Looks fine" }));
      stream.close();
    });
    // Stop is gone; Send is visibly busy rather than silently dropping input.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.finishing).toBe(true);

    history.resolve(Response.json([]));
    await act(async () => sendPromise);
    expect(result.current.finishing).toBe(false);
  });

  it("only checks history before retrying a transport failure", async () => {
    const fetchMock = chatFetch([
      Response.json({ error: "Busy", kind: "overloaded" }, { status: 503 }),
      streamResponse([sse("done", { reply: "ok" })]),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderChat();
    await act(async () => {
      await result.current.send("q");
    });
    await act(async () => {
      await result.current.retry();
    });
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/chat/history")),
    ).toBe(false);
    expect(result.current.messages.at(-1)?.content).toBe("ok");
  });

  it("matches a stored multipart prompt despite CRLF line endings", async () => {
    const fetchMock = chatFetch(
      [streamResponse([sse("text_delta", { text: "x" })])],
      () => [
        { id: 10, role: "user", content: "line one\r\nline two", created_at: "2026-11-27T10:00:00.000Z", attachments: [] },
        { id: 11, role: "assistant", content: "Answer", created_at: "2026-11-27T10:00:05.000Z", attachments: [] },
      ],
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderChat();
    await act(async () => {
      await result.current.send("line one\nline two");
    });
    await act(async () => {
      await result.current.retry();
    });
    expect(postBodies(fetchMock)).toHaveLength(1);
    expect(result.current.messages.at(-1)?.content).toBe("Answer");
  });

  it("keeps a recovered interrupted exchange when the user asks again", async () => {
    const fetchMock = chatFetch(
      [
        streamResponse([sse("text_delta", { text: "Half" })]),
        streamResponse([sse("done", { reply: "Continued" })]),
      ],
      () => [
        { id: 10, role: "user", content: "q", created_at: "2026-11-27T10:00:00.000Z", attachments: [] },
        { id: 11, role: "assistant", content: "Half", status: "aborted", created_at: "2026-11-27T10:00:05.000Z", attachments: [] },
      ],
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderChat();
    await act(async () => {
      await result.current.send("q");
    });
    await act(async () => {
      await result.current.retry();
    });
    await act(async () => {
      await result.current.send("continue");
    });
    expect(result.current.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "q" },
      { role: "assistant", content: "Half" },
      { role: "user", content: "continue" },
      { role: "assistant", content: "Continued" },
    ]);
  });

  it("does not refresh the router (and bounce to sign-in) after an expired session", async () => {
    router.refresh.mockReset();
    vi.stubGlobal("fetch", chatFetch([new Response("Unauthorized", { status: 401 })]));
    const { result } = renderChat();
    await act(async () => {
      await result.current.send("keep me");
    });
    expect(result.current.messages.at(-1)?.error?.errorClass).toBe("session_expired");
    expect(result.current.input).toBe("keep me");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("never restores a failed Retry's images past the 3-image limit", async () => {
    stubObjectUrls();
    vi.stubGlobal(
      "fetch",
      chatFetch([
        Response.json({ error: "Busy", kind: "overloaded" }, { status: 503 }),
        Response.json({ error: "Busy", kind: "overloaded" }, { status: 503 }),
      ]),
    );
    const { result } = renderChat();
    const original = new File(["o"], "o.jpg", { type: "image/jpeg" });
    act(() => result.current.addImages([original]));
    await act(async () => {
      await result.current.send("what is this?");
    });
    act(() => result.current.removeImage(result.current.pendingImages[0].id));
    const replacements = ["1", "2", "3"].map((n) => new File([n], `${n}.jpg`, { type: "image/jpeg" }));
    act(() => result.current.addImages(replacements));

    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.pendingImages.map((image) => image.file)).toEqual(replacements);
  });

  it("retrying an image turn keeps images attached since, and sends only the failed ones", async () => {
    stubObjectUrls();
    const fetchMock = chatFetch([
      Response.json({ error: "Busy", kind: "overloaded" }, { status: 503 }),
      streamResponse([sse("done", { reply: "ok" })]),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderChat();
    const a = new File(["a"], "a.jpg", { type: "image/jpeg" });
    const b = new File(["b"], "b.jpg", { type: "image/jpeg" });

    act(() => result.current.addImages([a]));
    await act(async () => {
      await result.current.send("what is this?");
    });
    expect(result.current.pendingImages.map((image) => image.file)).toEqual([a]);
    act(() => result.current.addImages([b]));

    await act(async () => {
      await result.current.retry();
    });

    const retryPost = fetchMock.mock.calls.filter(([url]) => url === "/api/chat")[1];
    const form = retryPost[1]?.body as FormData;
    expect(form.getAll("images")).toEqual([a]);
    expect(result.current.pendingImages.map((image) => image.file)).toEqual([b]);
  });
});

describe("useChatSend retry with an untrustworthy history read", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("treats a history read with fewer prompts than shown as unknown, not absent", async () => {
    const fetchMock = chatFetch([streamResponse([sse("text_delta", { text: "x" })])], () => []);
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderChat([
      { id: 1, role: "user", content: "earlier", created_at: "2026-11-27T10:00:00.000Z", attachments: [] },
      { id: 2, role: "assistant", content: "reply", created_at: "2026-11-27T10:00:01.000Z", attachments: [] },
    ]);
    await act(async () => {
      await result.current.send("q");
    });
    await act(async () => {
      await result.current.retry();
    });
    expect(postBodies(fetchMock)).toHaveLength(1);
    expect(result.current.messages.at(-1)?.error?.detail).toMatch(/wasn't resent/);
  });
});

describe("useChatSend context-window figure (issue #608)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    router.refresh.mockReset();
  });

  function renderWithContext(
    initialContext: { tokens: number; approximate: boolean } | null,
  ) {
    return renderHook(
      ({ id }: { id: number }) =>
        useChatSend({
          initialMessages: emptyMessages,
          initialContext,
          threadId: id,
          setThreadId: vi.fn(),
          refreshThreads: vi.fn(async () => []),
        }),
      { initialProps: { id: 1 } },
    );
  }

  it("starts hidden for a new thread and shows the figure the done event reports", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([
          sse("done", {
            reply: "Hi",
            work_log: null,
            context: { tokens: 42_000, approximate: false },
          }),
        ]),
      ),
    );
    const { result } = renderWithContext(null);
    expect(result.current.context).toBeNull();
    await act(async () => {
      await result.current.send("hello");
    });
    expect(result.current.context).toEqual({ tokens: 42_000, approximate: false });
  });

  it("keeps the previous figure when done carries none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([sse("done", { reply: "Hi", work_log: null })])),
    );
    const { result } = renderWithContext({ tokens: 9_000, approximate: true });
    await act(async () => {
      await result.current.send("hello");
    });
    expect(result.current.context).toEqual({ tokens: 9_000, approximate: true });
  });

  it("loads the selected thread's figure on a client-side switch and restores it on return", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url) === "/api/chat/history?thread_id=2&include=context"
        ? Response.json({ messages: [], context: { tokens: 150_000, approximate: false } })
        : Response.json({ messages: [], context: { tokens: 5_000, approximate: false } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { result, rerender } = renderWithContext({ tokens: 5_000, approximate: false });
    expect(result.current.context).toEqual({ tokens: 5_000, approximate: false });

    rerender({ id: 2 });
    // Unvisited thread: hidden until its history arrives, never thread 1's figure.
    expect(result.current.context).toBeNull();
    await waitFor(() =>
      expect(result.current.context).toEqual({ tokens: 150_000, approximate: false }),
    );

    rerender({ id: 1 });
    // Cached figure paints immediately while the thread revalidates.
    expect(result.current.context).toEqual({ tokens: 5_000, approximate: false });
  });
});
