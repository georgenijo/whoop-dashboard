import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCoachThread, type ChatMessage, type ThreadSummary } from "./useCoachThread";

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
    message_count: 0,
    last_preview: null,
  },
];
const initialMessages: ChatMessage[] = [];

describe("useCoachThread", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(initialThreads)));
  });

  it("composes thread, message, and UI state without throwing", () => {
    const { result, unmount } = renderHook(() =>
      useCoachThread(1, initialThreads, initialMessages)
    );

    expect(result.current.threadId).toBe(1);
    expect(result.current.threads).toEqual(initialThreads);
    expect(result.current.messages).toEqual([]);
    expect(result.current.mobileOpen).toBe(false);
    expect(result.current.input).toBe("");
    expect(result.current.activeThread?.id).toBe(1);
    expect(result.current.inputRef).toHaveProperty("current");
    expect(result.current.bottomRef).toHaveProperty("current");
    expect(result.current.send).toEqual(expect.any(Function));
    expect(result.current.handleKeyDown).toEqual(expect.any(Function));
    unmount();
  });
});
