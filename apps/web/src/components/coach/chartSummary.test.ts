import { describe, expect, it } from "vitest";
import { summarizeSeries, svgSafeId } from "./chartSummary";

describe("summarizeSeries", () => {
  it("leads with the latest value and the change across the window", () => {
    expect(summarizeSeries([60, 61, 62], "ms")).toEqual({ latest: "62 ms", change: "↑ 2 ms", direction: "up" });
    expect(summarizeSeries([80, 66], "%")).toEqual({ latest: "66%", change: "↓ 14 pts", direction: "down" });
    expect(summarizeSeries([66, 67], "%")?.change).toBe("↑ 1 pt");
  });

  it("skips gaps at either end", () => {
    expect(summarizeSeries([null, 50, 55, null], "bpm")).toEqual({ latest: "55 bpm", change: "↑ 5 bpm", direction: "up" });
  });

  it("handles flat, single-point, empty and unitless series", () => {
    expect(summarizeSeries([12.4, 12.4], "")).toEqual({ latest: "12.4", change: "Flat", direction: "flat" });
    expect(summarizeSeries([7], "h")).toEqual({ latest: "7 h", change: null, direction: "flat" });
    expect(summarizeSeries([null, undefined], "ms")).toBeNull();
    expect(summarizeSeries([1000, 1500.25], "kJ")?.latest).toBe("1,500.3 kJ");
  });
});

describe("svgSafeId", () => {
  it("strips characters that break url(#id) references", () => {
    expect(svgSafeId(":r1:")).toBe("r1");
    expect(svgSafeId("«r2»")).toBe("r2");
  });
});
