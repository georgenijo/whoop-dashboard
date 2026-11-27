import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposerMessage } from "./useChatSend";

// Count sanitizer passes without changing what they produce.
const sanitize = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock("@/lib/render-markdown", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/render-markdown")>();
  return {
    ...actual,
    renderMarkdownToSafeHtml: (markdown: string) => {
      sanitize.calls.push(markdown);
      return actual.renderMarkdownToSafeHtml(markdown);
    },
  };
});

const { default: MessageList } = await import("./MessageList");

let frames: FrameRequestCallback[] = [];
function flushFrame() {
  const pending = frames;
  frames = [];
  act(() => {
    for (const callback of pending) callback(performance.now());
  });
}

beforeEach(() => {
  sanitize.calls = [];
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settled: ComposerMessage = {
  clientId: "m:1",
  role: "assistant",
  content: "**Settled** answer",
  status: "complete",
};
const streaming = (content: string): ComposerMessage => ({
  clientId: "local:2",
  role: "assistant",
  content,
  streaming: true,
});

describe("MessageBubble render cost while streaming", () => {
  it("re-sanitizes only the streaming bubble, at most once per animation frame", async () => {
    const view = render(<MessageList messages={[settled, streaming("Hel")]} />);
    // Let the post-hydration markdown swap happen.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const settledPasses = () => sanitize.calls.filter((md) => md.includes("Settled")).length;
    const settledBefore = settledPasses();
    const before = sanitize.calls.length;

    // Three deltas inside one frame...
    for (const text of ["Hell", "Hello", "Hello, w"]) {
      view.rerender(<MessageList messages={[settled, streaming(text)]} />);
    }
    expect(sanitize.calls.length).toBe(before);

    // ...cost one render when the frame fires, of the latest text.
    flushFrame();
    expect(sanitize.calls.slice(before)).toEqual(["Hello, w"]);
    expect(settledPasses()).toBe(settledBefore);

    // Finishing renders the final text immediately, without waiting a frame.
    view.rerender(
      <MessageList messages={[settled, { ...streaming("Hello, world"), streaming: false }]} />,
    );
    expect(sanitize.calls.at(-1)).toBe("Hello, world");
    expect(view.container.textContent).toContain("Hello, world");
  });

  it("still sanitizes every rendered assistant message", async () => {
    const view = render(
      <MessageList
        messages={[
          { ...settled, content: '<img src=x onerror="alert(1)">safe' },
          streaming("<script>alert(1)</script>ok"),
        ]}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    flushFrame();
    expect(view.container.innerHTML).not.toContain("onerror");
    expect(view.container.innerHTML).not.toContain("<script");
  });
});
