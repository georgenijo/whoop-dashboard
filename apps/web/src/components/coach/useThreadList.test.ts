import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThreadList, type ThreadSummary } from "./useThreadList";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
// Like Next, `useSearchParams()` follows History API updates (jsdom applies
// pushState/replaceState to `location` synchronously).
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

// Moves the address bar without going through the spies (Back/Forward, or a
// full load of a deep link).
function setUrl(path: string) {
  History.prototype.replaceState.call(window.history, null, "", path);
}

const initialThreads: ThreadSummary[] = [
  {
    id: 1,
    title: "Recovery",
    updated_at: "2026-05-01T12:00:00.000Z",
    message_count: 1,
    last_preview: "How is recovery?",
  },
  {
    id: 3,
    title: "Sleep",
    updated_at: "2026-04-30T12:00:00.000Z",
    message_count: 2,
    last_preview: "Sleep?",
  },
];

function renderThreads(initialThreadId = 1) {
  const onNavigate = vi.fn();
  const view = renderHook(() =>
    useThreadList({ initialThreadId, initialThreads, onNavigate }),
  );
  return { ...view, onNavigate };
}

describe("useThreadList", () => {
  let pushState: ReturnType<typeof vi.spyOn>;
  let replaceState: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setUrl("/coach");
    router.push.mockReset();
    router.replace.mockReset();
    router.refresh.mockReset();
    pushState = vi.spyOn(window.history, "pushState");
    replaceState = vi.spyOn(window.history, "replaceState");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") return Response.json({ id: 2 });
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        return Response.json(initialThreads);
      }),
    );
  });

  afterEach(() => {
    pushState.mockRestore();
    replaceState.mockRestore();
  });

  it("selects a thread client-side: URL via the History API, no server navigation", () => {
    const { result, onNavigate } = renderThreads();

    act(() => result.current.handleSelectThread(3));

    expect(result.current.threadId).toBe(3);
    expect(result.current.activeThread?.title).toBe("Sleep");
    expect(pushState).toHaveBeenCalledWith(null, "", "/coach?thread=3");
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("doesn't snap back while Next has yet to apply the pushed URL", () => {
    const { result, rerender } = renderThreads();
    // Simulate the in-between render: our selection applied, URL not yet.
    pushState.mockImplementationOnce(() => undefined);

    act(() => result.current.handleSelectThread(3));
    rerender();

    expect(result.current.threadId).toBe(3);
  });

  it("follows Back/Forward through the URL's thread param", () => {
    const { result, rerender } = renderThreads();
    act(() => result.current.handleSelectThread(3));
    rerender();
    expect(result.current.threadId).toBe(3);

    // Back to the bare /coach entry: the newest thread the server rendered.
    setUrl("/coach");
    rerender();
    expect(result.current.threadId).toBe(1);

    // Forward again.
    setUrl("/coach?thread=3");
    rerender();
    expect(result.current.threadId).toBe(3);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("keeps a deep link's thread and leaves a valid address alone", () => {
    setUrl("/coach?thread=3");
    const { result } = renderThreads(3);

    expect(result.current.threadId).toBe(3);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("corrects the address bar when a deep link fell back to the newest thread", () => {
    setUrl("/coach?thread=99");
    const { result } = renderThreads(1);

    expect(result.current.threadId).toBe(1);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/coach?thread=1");
  });

  it("creates a thread and switches to it client-side", async () => {
    const { result, onNavigate } = renderThreads();

    await act(async () => {
      await result.current.handleCreateThread();
    });

    expect(fetch).toHaveBeenCalledWith("/api/threads", { method: "POST" });
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(result.current.threadId).toBe(2);
    expect(pushState).toHaveBeenCalledWith(null, "", "/coach?thread=2");
    expect(router.push).not.toHaveBeenCalled();
    // Cached /coach payloads predate the new thread; the router cache is cleared.
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("replaces the URL with the next thread when the active one is deleted", async () => {
    const { result } = renderThreads();

    await act(async () => {
      await result.current.handleDeleteThread(1);
    });

    expect(fetch).toHaveBeenCalledWith("/api/threads/1", { method: "DELETE" });
    expect(router.refresh).toHaveBeenCalledOnce();
    await waitFor(() => expect(result.current.threadId).toBe(1));
    expect(replaceState).toHaveBeenCalledWith(null, "", "/coach?thread=1");
    expect(pushState).not.toHaveBeenCalled();
  });

  it("leaves the router cache alone when the delete request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "DELETE"
          ? new Response(null, { status: 500 })
          : Response.json(initialThreads),
      ),
    );
    const { result } = renderThreads();

    await act(async () => {
      await result.current.handleDeleteThread(1);
    });

    expect(router.refresh).not.toHaveBeenCalled();
  });
});
