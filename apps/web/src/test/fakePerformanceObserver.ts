// Minimal PerformanceObserver stand-in for jsdom (which has none), good enough
// to drive Next's real `useReportWebVitals` -> bundled web-vitals code with
// synthetic entries: entries can be DELIVERED (the observer callback, like the
// browser's async delivery) or merely QUEUED (visible only to takeRecords(),
// which web-vitals calls when the page is hidden).
type Entry = Record<string, unknown>;
type Callback = (list: { getEntries: () => Entry[] }) => void;

export class FakePerformanceObserver {
  static supportedEntryTypes = ["paint", "layout-shift"];
  static instances: FakePerformanceObserver[] = [];
  type = "";
  disconnected = false;
  private queued: Entry[] = [];

  constructor(private callback: Callback) {
    FakePerformanceObserver.instances.push(this);
  }
  observe(options: { type: string }) {
    this.type = options.type;
  }
  takeRecords() {
    return this.queued.splice(0);
  }
  disconnect() {
    this.disconnected = true;
  }
  /** Browser-style delivery to the callback. */
  deliver(entries: Entry[]) {
    if (!this.disconnected) this.callback({ getEntries: () => entries });
  }
  /** Buffered but not yet delivered. */
  queue(entries: Entry[]) {
    this.queued.push(...entries);
  }

  static ofType(type: string) {
    return FakePerformanceObserver.instances.filter((o) => o.type === type);
  }
  static reset() {
    FakePerformanceObserver.instances = [];
  }
}
