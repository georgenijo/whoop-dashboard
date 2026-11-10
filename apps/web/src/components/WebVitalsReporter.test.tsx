import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

type Cb = (m: Record<string, unknown>) => void;
const callbacks: Cb[] = [];
vi.mock("next/web-vitals", () => ({
  useReportWebVitals: (cb: Cb) => { callbacks.push(cb); },
}));

import WebVitalsReporter from "./WebVitalsReporter";

const sendBeacon = vi.fn(() => true);
const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));

async function sent(): Promise<Array<{ metrics: Array<Record<string, unknown>> }>> {
  return Promise.all(
    (sendBeacon.mock.calls as unknown as Array<[string, Blob]>).map(async ([, blob]) => JSON.parse(await blob.text())),
  );
}
const emit = (m: Record<string, unknown>) => callbacks.at(-1)!(m);
const setVisibility = (v: "hidden" | "visible") =>
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v });
// Like the browser's own event: fired at `document`, and it bubbles to `window`.
const hide = (init: EventInit = { bubbles: true }) => {
  setVisibility("hidden");
  document.dispatchEvent(new Event("visibilitychange", init));
};

beforeEach(() => {
  callbacks.length = 0;
  sendBeacon.mockClear();
  fetchMock.mockClear();
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: sendBeacon });
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup(); // unmount flushes whatever is left
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setVisibility("visible");
});

describe("WebVitalsReporter", () => {
  it("sends ONE beacon for metrics that arrive far apart, at visibility hidden", async () => {
    render(<WebVitalsReporter />);
    emit({ id: "a", name: "TTFB", value: 100, rating: "good" });
    vi.advanceTimersByTime(1000);
    emit({ id: "b", name: "FCP", value: 900, rating: "good" });
    vi.advanceTimersByTime(5000);
    emit({ id: "c", name: "LCP", value: 2100, rating: "good" });
    vi.advanceTimersByTime(60_000);
    expect(sendBeacon).not.toHaveBeenCalled(); // no timer-based partial sends

    hide();
    const bodies = await sent();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].metrics.map((m) => m.metric)).toEqual(["TTFB", "FCP", "LCP"]);
  });

  it("flushes on pagehide and does not send twice", async () => {
    render(<WebVitalsReporter />);
    emit({ id: "a", name: "LCP", value: 1, rating: "good" });
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    hide();
    expect(await sent()).toHaveLength(1);
  });

  it("keeps the latest revision of a metric that Next re-reports", async () => {
    render(<WebVitalsReporter />);
    emit({ id: "cls", name: "CLS", value: 0.01, rating: "good" });
    emit({ id: "cls", name: "CLS", value: 0.2, rating: "needs-improvement" });
    hide();
    const [body] = await sent();
    expect(body.metrics).toHaveLength(1);
    expect(body.metrics[0]).toMatchObject({ metric: "CLS", value: 0.2 });
  });

  it("ignores non-standard metrics (Next hydration/render timings)", async () => {
    render(<WebVitalsReporter />);
    emit({ id: "h", name: "Next.js-hydration", value: 5 });
    hide();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("hands useReportWebVitals the SAME callback on every render", () => {
    const { rerender } = render(<WebVitalsReporter />);
    rerender(<WebVitalsReporter />);
    rerender(<WebVitalsReporter />);
    expect(callbacks.length).toBeGreaterThanOrEqual(3);
    expect(new Set(callbacks).size).toBe(1);
  });

  it("registers its lifecycle listeners once and does not flush on re-render", async () => {
    const addDoc = vi.spyOn(document, "addEventListener");
    const addWin = vi.spyOn(window, "addEventListener");
    const { rerender } = render(<WebVitalsReporter />);
    emit({ id: "a", name: "LCP", value: 1, rating: "good" });
    rerender(<WebVitalsReporter />);
    rerender(<WebVitalsReporter />);
    expect(sendBeacon).not.toHaveBeenCalled(); // the old cleanup flushed on every render
    expect(addDoc.mock.calls.filter(([t]) => t === "visibilitychange")).toHaveLength(1);
    expect(addWin.mock.calls.filter(([t]) => t === "pagehide")).toHaveLength(1);
    hide();
    expect(await sent()).toHaveLength(1);
    addDoc.mockRestore();
    addWin.mockRestore();
  });

  it("records the page a metric belongs to, not the page at flush time", async () => {
    render(<WebVitalsReporter />);
    window.history.pushState({}, "", "/sleep");
    emit({ id: "a", name: "LCP", value: 1, rating: "good" });
    window.history.pushState({}, "", "/recovery");
    emit({ id: "b", name: "FCP", value: 1, rating: "good" });
    hide();
    const [body] = await sent();
    expect(body.metrics.map((m) => m.path)).toEqual(["/sleep", "/recovery"]);
    window.history.pushState({}, "", "/");
  });

  it("falls back to a keepalive fetch when sendBeacon is unavailable", () => {
    Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: undefined });
    render(<WebVitalsReporter />);
    emit({ id: "a", name: "LCP", value: 1, rating: "good" });
    hide();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("includes a metric finalized by a listener registered AFTER the reporter's own (Next installs CLS's late)", async () => {
    render(<WebVitalsReporter />);
    emit({ id: "fcp", name: "FCP", value: 10, rating: "good" });
    // Stand-in for Next's CLS finalization: a document listener added after ours.
    const lateCls = () => {
      if (document.visibilityState === "hidden") emit({ id: "cls", name: "CLS", value: 0.2, rating: "poor" });
    };
    document.addEventListener("visibilitychange", lateCls);
    hide();
    document.removeEventListener("visibilitychange", lateCls);
    const bodies = await sent();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].metrics.map((m) => m.metric)).toEqual(["FCP", "CLS"]);
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event("pagehide"));
    expect(await sent()).toHaveLength(1);
  });

  it("still flushes, once, when the hidden event does not bubble (document listener defers to the next task)", async () => {
    render(<WebVitalsReporter />);
    emit({ id: "a", name: "FCP", value: 10, rating: "good" });
    hide({ bubbles: false });
    expect(sendBeacon).not.toHaveBeenCalled();
    emit({ id: "b", name: "CLS", value: 0.2, rating: "poor" }); // finalized later in the same dispatch
    vi.advanceTimersByTime(0);
    const bodies = await sent();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].metrics.map((m) => m.metric)).toEqual(["FCP", "CLS"]);
  });

  it("sends a metric that finalizes while the page is already hidden, coalescing metrics from the same task", async () => {
    render(<WebVitalsReporter />);
    hide();
    expect(sendBeacon).not.toHaveBeenCalled(); // nothing pending yet
    emit({ id: "l", name: "LCP", value: 2000, rating: "good" });
    emit({ id: "i", name: "INP", value: 150, rating: "good" });
    expect(sendBeacon).not.toHaveBeenCalled(); // deferred to the next task, not one beacon each
    vi.advanceTimersByTime(0);
    const bodies = await sent();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].metrics.map((m) => m.metric)).toEqual(["LCP", "INP"]);
  });

  it("does not send a second beacon for a lifecycle that was already flushed", async () => {
    render(<WebVitalsReporter />);
    emit({ id: "a", name: "FCP", value: 10, rating: "good" });
    hide();
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new Event("pagehide"));
    hide();
    expect(await sent()).toHaveLength(1);
  });
});
