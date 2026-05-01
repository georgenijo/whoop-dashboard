import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useThreadList, type ThreadSummary } from "./useThreadList";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
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
    unmount();
  });
});
