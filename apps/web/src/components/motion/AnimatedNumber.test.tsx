import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AnimatedNumber from "./AnimatedNumber";

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

function installMotionEnvironment() {
  const observers: ObserverCallback[] = [];
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: ObserverCallback) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  return {
    reveal: () => act(() => observers.forEach((callback) => callback([{ isIntersecting: true }]))),
  };
}

describe("AnimatedNumber", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders the settled value as plain text when motion is unavailable", () => {
    const { container } = render(<AnimatedNumber value="78%" />);
    expect(container.textContent).toBe("78%");
    expect(container.querySelector("[aria-hidden]")).toBeNull();
  });

  it("leaves compound values static even when motion is available", () => {
    installMotionEnvironment();
    const { container } = render(<AnimatedNumber value="7h 12m" />);
    expect(container.textContent).toBe("7h 12m");
  });

  it("parks at zero off-screen, keeps the real value for assistive tech, then counts up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "requestAnimationFrame", "performance"] });
    const { reveal } = installMotionEnvironment();
    const { container } = render(<AnimatedNumber value="45.8 ms" />);
    const visible = container.querySelector("[aria-hidden='true']")!;
    expect(visible.textContent).toBe("0.0 ms");
    expect(container.querySelector(".sr-only")?.textContent).toBe("45.8 ms");

    reveal();
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    const midway = Number.parseFloat(visible.textContent ?? "0");
    expect(midway).toBeGreaterThan(0);
    expect(midway).toBeLessThan(45.8);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(visible.textContent).toBe("45.8 ms");
  });
});
