import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatSend } from "./useChatSend";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
      useChatSend({ initialMessages: [], threadId: 1, setThreadId, refreshThreads })
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
      reply.resolve(new Response("You are trending well.", { headers: { "x-thread-id": "2" } }));
      await sendPromise;
    });

    expect(result.current.messages).toEqual([
      { role: "user", content: "How am I doing?" },
      { role: "assistant", content: "You are trending well." },
    ]);
    expect(setThreadId).toHaveBeenCalledWith(2);
    expect(refreshThreads).toHaveBeenCalledOnce();
  });

  it("aborts the prior in-flight request when send is invoked again", async () => {
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
        initialMessages: [],
        threadId: 1,
        setThreadId: vi.fn(),
        refreshThreads: vi.fn(async () => []),
      })
    );

    let firstSend: Promise<void> = Promise.resolve();
    let secondSend: Promise<void> = Promise.resolve();
    act(() => {
      firstSend = result.current.send("First");
      secondSend = result.current.send("Second");
    });

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].signal.aborted).toBe(false);

    await act(async () => {
      requests[1].resolve(new Response("Second reply"));
      await Promise.allSettled([firstSend, secondSend]);
    });
  });
});
