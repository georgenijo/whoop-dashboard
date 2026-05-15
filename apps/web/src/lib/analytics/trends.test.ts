import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { rollingMean, rollingMeanStd, detectHRVAnomalies } from "./trends";

describe("rollingMean", () => {
  it("returns empty array for empty input", () => {
    expect(rollingMean([], 7)).toEqual([]);
  });

  it("returns nulls for an all-null series", () => {
    expect(rollingMean([null, null, null], 3)).toEqual([null, null, null]);
  });

  it("handles a mixed null + numeric series", () => {
    const out = rollingMean([1, null, 3, null, 5], 3);
    // i=0: [1] -> 1
    // i=1: [1,null] -> 1
    // i=2: [1,null,3] -> 2
    // i=3: [null,3,null] -> 3
    // i=4: [3,null,5] -> 4
    expect(out).toEqual([1, 1, 2, 3, 4]);
  });

  it("window > length still returns a mean from available values", () => {
    // The function uses Math.max(0, i - (window-1)) so it never reads past
    // the start of the array; the comparison "window > length" doesn't
    // change behaviour — every prefix is meaned.
    expect(rollingMean([2, 4], 10)).toEqual([2, 3]);
  });

  it("returns all nulls when every window is empty", () => {
    expect(rollingMean([null, null], 2)).toEqual([null, null]);
  });
});

describe("rollingMeanStd", () => {
  it("requires minPeriods before reporting stats", () => {
    const vals = [1, 2, 3, 4, 5];
    const { mean, std } = rollingMeanStd(vals, 5, 5);
    // Only the last index has ≥5 valid samples in the trailing window.
    expect(mean.slice(0, 4)).toEqual([null, null, null, null]);
    expect(mean[4]).toBeCloseTo(3, 6);
    expect(std[4]).toBeCloseTo(Math.sqrt(2), 6);
  });
});

describe("detectHRVAnomalies", () => {
  it("returns nothing for monotonic-increasing data", () => {
    const points = Array.from({ length: 30 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, "0")}`,
      hrv: 40 + i,
    }));
    expect(detectHRVAnomalies(points)).toEqual([]);
  });

  it("flags a 25% drop after a long stable baseline", () => {
    // 30 days of stable HRV ~ 50ms, then one day at 37.5 (25% below).
    const stable = Array.from({ length: 30 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, "0")}`,
      hrv: 50 + (i % 2 === 0 ? 0.5 : -0.5), // tiny jitter so std > 0
    }));
    const drop = { date: "2025-01-31", hrv: 37.5 };
    const points = [...stable, drop];
    const anomalies = detectHRVAnomalies(points);
    expect(anomalies.length).toBeGreaterThan(0);
    const flagged = anomalies.find((a) => a.date === "2025-01-31");
    expect(flagged).toBeDefined();
    expect(flagged!.pct_below).toBeGreaterThan(20);
    expect(flagged!.baseline_ms).toBeCloseTo(50, 0);
  });
});
