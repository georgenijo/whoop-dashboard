// Integration regression test: drives the REAL `useReportWebVitals` from
// next/web-vitals (Next 16.2.4's bundled web-vitals), not a mock. Next
// finalizes CLS in its own `visibilitychange` listener, which it installs only
// after the asynchronous FCP observation - i.e. after the reporter's own
// listeners. A flush from a plain `document` listener therefore sent FCP alone
// and CLS in a second beacon (or never). Kept to ONE scenario per file because
// the externalized web-vitals module keeps module-level state (first hidden
// time) that cannot be reset between tests.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { FakePerformanceObserver } from "@/test/fakePerformanceObserver";
import WebVitalsReporter from "./WebVitalsReporter";

const sendBeacon = vi.fn(() => true);

async function beacons(): Promise<Array<{ metrics: Array<Record<string, unknown>> }>> {
  return Promise.all(
    (sendBeacon.mock.calls as unknown as Array<[string, Blob]>).map(async ([, blob]) => JSON.parse(await blob.text())),
  );
}
const tick = () => new Promise<void>((r) => setTimeout(r, 5));

beforeEach(() => {
  FakePerformanceObserver.reset();
  vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: sendBeacon });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("FCP + a layout shift, then the page is hidden: exactly one beacon with both FCP and CLS", async () => {
  render(<WebVitalsReporter />);

  // Browser delivers first-contentful-paint (async observer callback) ...
  const paintObservers = FakePerformanceObserver.ofType("paint");
  expect(paintObservers.length).toBeGreaterThan(0);
  for (const o of paintObservers) o.deliver([{ name: "first-contentful-paint", entryType: "paint", startTime: 10 }]);
  await tick(); // web-vitals hops through Promise.resolve().then before reading entries

  // ... CLS observation only starts after FCP, then a layout shift is buffered.
  const shiftObservers = FakePerformanceObserver.ofType("layout-shift");
  expect(shiftObservers).toHaveLength(1);
  shiftObservers[0].queue([{ entryType: "layout-shift", value: 0.2, startTime: 20, hadRecentInput: false }]);
  expect(sendBeacon).not.toHaveBeenCalled();

  // The page is hidden. Next's CLS listener (installed after ours) finalizes CLS here.
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));

  let sent = await beacons();
  expect(sent).toHaveLength(1);
  expect(sent[0].metrics.map((m) => m.metric).sort()).toEqual(["CLS", "FCP"]);
  expect(sent[0].metrics.find((m) => m.metric === "CLS")).toMatchObject({ value: 0.2 });
  expect(sent[0].metrics.find((m) => m.metric === "FCP")).toMatchObject({ value: 10 });

  // Nothing else follows for this lifecycle: not from pagehide, not from a later task.
  window.dispatchEvent(new Event("pagehide"));
  await tick();
  sent = await beacons();
  expect(sent).toHaveLength(1);
});
