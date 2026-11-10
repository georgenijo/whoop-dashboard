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
const hide = () => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
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
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
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
});
