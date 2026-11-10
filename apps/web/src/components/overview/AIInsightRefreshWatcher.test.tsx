import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const fetchStatus = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
import AIInsightRefreshWatcher from "./AIInsightRefreshWatcher";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchStatus);
  fetchStatus.mockResolvedValue({ ok: true, json: async () => ({ ready: false, isRegenerating: true, errorClass: null }) });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("AIInsightRefreshWatcher", () => {
  it("keeps checking after 30 seconds with increasing delays and no page refreshes", async () => {
    render(<AIInsightRefreshWatcher />);
    await advance(35_000);
    expect(fetchStatus).toHaveBeenCalledTimes(4); // 2, 6, 14, 30 seconds
    expect(fetchStatus).toHaveBeenCalledWith("/api/insights/status", expect.objectContaining({ cache: "no-store" }));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes exactly once when ready, then stops polling", async () => {
    render(<AIInsightRefreshWatcher />);
    await advance(6_000);
    fetchStatus.mockResolvedValue({ ok: true, json: async () => ({ ready: true, isRegenerating: false, errorClass: null }) });
    await advance(8_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await advance(300_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(fetchStatus).toHaveBeenCalledTimes(3);
  });

  it("shows a failed generation in the card without refreshing or retrying generation", async () => {
    fetchStatus.mockResolvedValue({ ok: true, json: async () => ({ ready: false, isRegenerating: false, errorClass: "bad_key" }) });
    render(<AIInsightRefreshWatcher />);
    await advance(2_000);
    expect(screen.getByRole("status")).toHaveTextContent("Insight unavailable (bad key)");
    await advance(300_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops checking after the five-minute regeneration window", async () => {
    render(<AIInsightRefreshWatcher />);
    await advance(360_000);
    const count = fetchStatus.mock.calls.length;
    expect(count).toBeLessThan(15);
    expect(screen.getByRole("status")).toHaveTextContent("provider error");
    await advance(300_000);
    expect(fetchStatus).toHaveBeenCalledTimes(count);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("retries transient polling failures with backoff and stops on expired auth", async () => {
    fetchStatus.mockRejectedValueOnce(new Error("network offline"));
    render(<AIInsightRefreshWatcher />);
    await advance(2_000);
    fetchStatus.mockResolvedValue({ ok: false, status: 401 });
    await advance(4_000);
    await advance(300_000);
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("stops checking when unmounted and aborts in-flight requests", async () => {
    fetchStatus.mockImplementation((_url, options) => new Promise((resolve) => {
      options.signal.addEventListener("abort", () => resolve({ ok: false, status: 499 }));
    }));
    const { unmount } = render(<AIInsightRefreshWatcher />);
    await advance(2_000);
    const signal = fetchStatus.mock.calls[0][1].signal;
    unmount();
    expect(signal.aborted).toBe(true);
    await advance(300_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(refresh).not.toHaveBeenCalled();
  });
});
