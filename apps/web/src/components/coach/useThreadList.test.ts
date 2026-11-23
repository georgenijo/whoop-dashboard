import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useThreadList, type ThreadSummary } from "./useThreadList";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const initialThreads: ThreadSummary[] = [
  {
    id: 1,
    title: "Recovery",
    updated_at: "2026-05-01T12:00:00.000Z",
    message_count: 1,
    last_preview: "How is recovery?",
  },
];

describe("useThreadList", () => {
  beforeEach(() => {
    router.push.mockReset();
    router.replace.mockReset();
    router.refresh.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") return Response.json({ id: 2 });
        return Response.json(initialThreads);
      })
    );
  });

  it("returns initial threads and creates a new thread", async () => {
    const onNavigate = vi.fn();
    const { result, unmount } = renderHook(() =>
      useThreadList({ initialThreadId: 1, initialThreads, onNavigate })
    );

    expect(result.current.threads).toEqual(initialThreads);
    expect(result.current.activeThread?.title).toBe("Recovery");

    await act(async () => {
      await result.current.handleCreateThread();
    });

    expect(fetch).toHaveBeenCalledWith("/api/threads", { method: "POST" });
    expect(onNavigate).toHaveBeenCalledOnce();
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/coach?thread=2"));
    // Cached /coach payloads predate the new thread; the router cache is cleared.
    expect(router.refresh).toHaveBeenCalledOnce();
    unmount();
  });

  it("clears the router cache when a thread is deleted", async () => {
    const onNavigate = vi.fn();
    const { result, unmount } = renderHook(() =>
      useThreadList({ initialThreadId: 1, initialThreads, onNavigate })
    );

    await act(async () => {
      await result.current.handleDeleteThread(1);
    });

    expect(fetch).toHaveBeenCalledWith("/api/threads/1", { method: "DELETE" });
    expect(router.refresh).toHaveBeenCalledOnce();
    unmount();
  });

  it("leaves the router cache alone when the delete request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "DELETE"
          ? new Response(null, { status: 500 })
          : Response.json(initialThreads)
      )
    );
    const { result, unmount } = renderHook(() =>
      useThreadList({ initialThreadId: 1, initialThreads, onNavigate: vi.fn() })
    );

    await act(async () => {
      await result.current.handleDeleteThread(1);
    });

    expect(router.refresh).not.toHaveBeenCalled();
    unmount();
  });
});
