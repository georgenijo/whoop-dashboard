import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import AIInsightRefreshWatcher from "./AIInsightRefreshWatcher";

const fetchMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  refresh.mockReset();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AIInsightRefreshWatcher", () => {
  it("polls the status route with backoff and refreshes once when ready", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ready: false, failed: false }));
    render(<AIInsightRefreshWatcher />);

    // First poll after 2s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();

    // Next poll waits 5s (not another 2s).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockResolvedValue(jsonResponse({ ready: true }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);

    // Terminal state stops polling rather than re-rendering every few seconds.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes once and stops after a terminal failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ready: false, failed: true }));
    render(<AIInsightRefreshWatcher />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the watcher unmounts", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ready: false, failed: false }));
    const { unmount } = render(<AIInsightRefreshWatcher />);

    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
