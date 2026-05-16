import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSend, type ChatMessage } from "./useChatSend";

const emptyMessages: ChatMessage[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamResponse(chunks: string[], headers?: HeadersInit): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers }
  );
}

function controllableStreamResponse(headers?: HeadersInit) {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(
    new ReadableStream({
      start(c) {
        controller = c;
      },
    }),
    { headers }
  );
  return {
    response,
    send: (chunk: string) => controller.enqueue(encoder.encode(chunk)),
    close: () => controller.close(),
  };
}

describe("useChatSend", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("optimistically inserts the user message and replaces the assistant placeholder", async () => {
    const reply = deferred<Response>();
    const setThreadId = vi.fn();
    const refreshThreads = vi.fn(async () => []);
    vi.stubGlobal("fetch", vi.fn(() => reply.promise));

    const { result } = renderHook(() =>
      useChatSend({ initialMessages: emptyMessages, threadId: 1, setThreadId, refreshThreads })
    );

    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("How am I doing?");
    });

    await waitFor(() =>
      expect(result.current.messages).toEqual([
        { role: "user", content: "How am I doing?" },
        { role: "assistant", content: "", streaming: true },
      ])
    );

    await act(async () => {
      reply.resolve(
        streamResponse(
          [
            "event: text_delta\ndata: {\"text\":\"You",
            " are\"}\n\n",
            sse("text_delta", { text: " trending well." }),
            sse("done", { reply: "You are trending well." }),
          ],
          { "x-thread-id": "2" }
        )
      );
      await sendPromise;
    });

    expect(result.current.messages).toEqual([
      { role: "user", content: "How am I doing?" },
      { role: "assistant", content: "You are trending well." },
    ]);
    expect(setThreadId).toHaveBeenCalledWith(2);
    expect(refreshThreads).toHaveBeenCalledOnce();
  });

  it("aborts and replaces the prior in-flight request when send is invoked again", async () => {
    const requests: {
      signal: AbortSignal;
      resolve: (value: Response) => void;
      reject: (reason?: unknown) => void;
    }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        return new Promise<Response>((resolve, reject) => {
          requests.push({ signal, resolve, reject });
          signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      })
    );

    const { result } = renderHook(() =>
      useChatSend({
        initialMessages: emptyMessages,
        threadId: 1,
        setThreadId: vi.fn(),
        refreshThreads: vi.fn(async () => []),
      })
    );

    let firstSend: Promise<void> = Promise.resolve();
    let secondSend: Promise<void> = Promise.resolve();
    act(() => {
      firstSend = result.current.send("First");
    });

    await waitFor(() => expect(result.current.loading).toBe(true));
    act(() => {
      secondSend = result.current.send("Second");
    });

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].signal.aborted).toBe(false);
    expect(result.current.messages).toEqual([
      { role: "user", content: "Second" },
      { role: "assistant", content: "", streaming: true },
    ]);

    await act(async () => {
      requests[1].resolve(
        streamResponse([
          sse("text_delta", { text: "Second reply" }),
          sse("done", { reply: "Second reply" }),
        ])
      );
      await Promise.allSettled([firstSend, secondSend]);
    });

    expect(result.current.messages).toEqual([
      { role: "user", content: "Second" },
      { role: "assistant", content: "Second reply" },
    ]);
  });

  it("resets local state and aborts in-flight work when the thread changes", async () => {
    const requests: { signal: AbortSignal; reject: (reason?: unknown) => void }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          requests.push({ signal, reject });
          signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      })
    );

    const threadOneMessages: ChatMessage[] = [
      { id: 1, role: "user", content: "Old thread", created_at: "2026-05-01T12:00:00.000Z" },
    ];
    const threadTwoMessages: ChatMessage[] = [
      { id: 2, role: "assistant", content: "New thread", created_at: "2026-05-01T12:01:00.000Z" },
    ];
    const props = {
      setThreadId: vi.fn(),
      refreshThreads: vi.fn(async () => []),
    };
    const { result, rerender } = renderHook(
      ({ threadId, initialMessages }: { threadId: number; initialMessages: ChatMessage[] }) =>
        useChatSend({ ...props, threadId, initialMessages }),
      { initialProps: { threadId: 1, initialMessages: threadOneMessages } }
    );

    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      result.current.setInput("draft");
      sendPromise = result.current.send("Pending");
    });
    await waitFor(() => expect(requests).toHaveLength(1));

    rerender({ threadId: 2, initialMessages: threadTwoMessages });

    await waitFor(() =>
      expect(result.current.messages).toEqual([{ role: "assistant", content: "New thread" }])
    );
    expect(result.current.input).toBe("");
    expect(result.current.loading).toBe(false);
    expect(requests[0].signal.aborted).toBe(true);
    await Promise.allSettled([sendPromise]);
  });

  it("shows the latest tool progress and collapses it when text streams", async () => {
    const reply = deferred<Response>();
    const stream = controllableStreamResponse();
    vi.stubGlobal("fetch", vi.fn(() => reply.promise));

    const { result } = renderHook(() =>
      useChatSend({
        initialMessages: emptyMessages,
        threadId: 1,
        setThreadId: vi.fn(),
        refreshThreads: vi.fn(async () => []),
      })
    );

    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("Check recovery");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    await act(async () => {
      reply.resolve(stream.response);
    });

    act(() => {
      stream.send(sse("tool_use_start", { name: "query_recovery", input: {} }));
    });
    await waitFor(() => {
      expect(result.current.messages[1].progress).toEqual({
        name: "query_recovery",
        state: "running",
      });
      expect(result.current.progressLabel).toBe("Coach is running recovery…");
    });

    act(() => {
      stream.send(
        sse("tool_use_end", {
          name: "query_recovery",
          duration_ms: 42,
          rows: 3,
          status: "ok",
        })
      );
    });
    await waitFor(() => {
      expect(result.current.messages[1].progress).toEqual({
        name: "query_recovery",
        state: "done",
        duration_ms: 42,
        rows: 3,
        status: "ok",
      });
      expect(result.current.progressLabel).toBe("Queried recovery in 42ms");
    });

    act(() => {
      stream.send(sse("text_delta", { text: "Recovery looks steady." }));
    });
    await waitFor(() =>
      expect(result.current.messages[1]).toEqual({
        role: "assistant",
        content: "Recovery looks steady.",
        streaming: true,
        progress: null,
      })
    );

    await act(async () => {
      stream.send(sse("done", { reply: "Recovery looks steady." }));
      stream.close();
      await sendPromise;
    });

    expect(result.current.messages[1]).toEqual({
      role: "assistant",
      content: "Recovery looks steady.",
    });
  });

  it("shows an error when the stream ends before the done event", async () => {
    const reply = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn(() => reply.promise));

    const { result } = renderHook(() =>
      useChatSend({
        initialMessages: emptyMessages,
        threadId: 1,
        setThreadId: vi.fn(),
        refreshThreads: vi.fn(async () => []),
      })
    );

    let sendPromise: Promise<void> = Promise.resolve();
    act(() => {
      sendPromise = result.current.send("Drop test");
    });

    await act(async () => {
      reply.resolve(streamResponse([sse("text_delta", { text: "Partial" })]));
      await sendPromise;
    });

    expect(result.current.messages).toEqual([
      { role: "user", content: "Drop test" },
      {
        role: "assistant",
        content: "**Error:** Connection lost before Coach finished.",
      },
    ]);
  });
});
