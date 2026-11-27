import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { NEAR_BOTTOM_PX, useAutoScroll } from "./useAutoScroll";

afterEach(cleanup);

// jsdom has no layout, so give the scroller fixed, writable metrics.
function fakeMetrics(element: HTMLElement, scrollHeight: number, clientHeight: number) {
  let scrollTop = 0;
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, get: () => scrollHeight },
    clientHeight: { configurable: true, get: () => clientHeight },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(value, scrollHeight - clientHeight));
      },
    },
  });
  return {
    grow: (next: number) => {
      scrollHeight = next;
    },
  };
}

function Harness({ content, threadId }: { content: string; threadId: number }) {
  const { containerRef, onScroll, showJump, jumpToLatest } = useAutoScroll(
    content,
    threadId,
  );
  return (
    <>
      <div data-testid="scroller" ref={containerRef} onScroll={onScroll}>
        {content}
      </div>
      {showJump ? <button onClick={jumpToLatest}>Jump to latest</button> : null}
    </>
  );
}

function setup() {
  const view = render(<Harness content="a" threadId={1} />);
  const scroller = screen.getByTestId("scroller");
  const metrics = fakeMetrics(scroller, 1000, 400);
  return { ...view, scroller, metrics };
}

describe("useAutoScroll", () => {
  it("follows streamed content while the reader is at the bottom", () => {
    const { rerender, scroller, metrics } = setup();
    scroller.scrollTop = 600;
    fireEvent.scroll(scroller);

    metrics.grow(1300);
    rerender(<Harness content="ab" threadId={1} />);

    expect(scroller.scrollTop).toBe(900);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });

  it(`still follows when within ${NEAR_BOTTOM_PX}px of the bottom`, () => {
    const { rerender, scroller, metrics } = setup();
    scroller.scrollTop = 600 - NEAR_BOTTOM_PX;
    fireEvent.scroll(scroller);

    metrics.grow(1300);
    rerender(<Harness content="ab" threadId={1} />);

    expect(scroller.scrollTop).toBe(900);
  });

  it("leaves a reader who scrolled up alone and offers Jump to latest", () => {
    const { rerender, scroller, metrics } = setup();
    scroller.scrollTop = 200;
    fireEvent.scroll(scroller);

    metrics.grow(1300);
    rerender(<Harness content="ab" threadId={1} />);

    expect(scroller.scrollTop).toBe(200);
    const jump = screen.getByRole("button", { name: "Jump to latest" });

    fireEvent.click(jump);
    expect(scroller.scrollTop).toBe(900);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();

    // Re-pinned: the next delta follows again.
    metrics.grow(1500);
    rerender(<Harness content="abc" threadId={1} />);
    expect(scroller.scrollTop).toBe(1100);
  });

  it("offers Jump to latest as soon as the reader scrolls up, without new content", () => {
    const { scroller } = setup();
    act(() => {
      scroller.scrollTop = 100;
      fireEvent.scroll(scroller);
    });
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeInTheDocument();
  });

  it("hides Jump to latest once the reader scrolls back down", () => {
    const { rerender, scroller, metrics } = setup();
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    metrics.grow(1300);
    rerender(<Harness content="ab" threadId={1} />);
    expect(screen.getByRole("button", { name: "Jump to latest" })).toBeInTheDocument();

    act(() => {
      scroller.scrollTop = 900;
      fireEvent.scroll(scroller);
    });
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });

  it("opens a different thread at its newest message", () => {
    const { rerender, scroller } = setup();
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);

    rerender(<Harness content="other thread" threadId={2} />);

    expect(scroller.scrollTop).toBe(600);
    expect(screen.queryByRole("button", { name: "Jump to latest" })).toBeNull();
  });
});
