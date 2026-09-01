import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import AIInsightRefreshWatcher from "./AIInsightRefreshWatcher";

afterEach(() => {
  cleanup();
  refresh.mockReset();
  vi.useRealTimers();
});

describe("AIInsightRefreshWatcher", () => {
  it("keeps checking after a regeneration has run for 30 seconds", () => {
    vi.useFakeTimers();
    render(<AIInsightRefreshWatcher />);

    act(() => {
      vi.advanceTimersByTime(35_000);
    });

    expect(refresh).toHaveBeenCalledTimes(7);
  });

  it("stops checking after the five-minute regeneration window", () => {
    vi.useFakeTimers();
    render(<AIInsightRefreshWatcher />);

    act(() => {
      vi.advanceTimersByTime(305_000);
    });

    expect(refresh).toHaveBeenCalledTimes(60);
  });

  it("stops checking when the watcher unmounts", () => {
    vi.useFakeTimers();
    const { unmount } = render(<AIInsightRefreshWatcher />);

    unmount();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(refresh).not.toHaveBeenCalled();
  });
});
