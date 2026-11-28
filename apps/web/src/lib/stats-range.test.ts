import { describe, expect, it } from "vitest";
import {
  resolveStatsRange,
  sportFromParam,
  sportStatsHref,
  summarizeSportSessions,
} from "./stats-range";

describe("sportStatsHref / sportFromParam (issue #430)", () => {
  const names = [
    "Running",
    "Functional Fitness",
    "HIIT/Circuit",
    "Box & Weights",
    "Unknown",
    "100% Effort",
    "Café?#",
  ];

  it("encodes every reserved character so the sport stays one path segment", () => {
    expect(sportStatsHref("HIIT/Circuit")).toBe("/stats/HIIT%2FCircuit");
    expect(sportStatsHref("Box & Weights")).toBe("/stats/Box%20%26%20Weights");
    expect(sportStatsHref("Café?#")).toBe("/stats/Caf%C3%A9%3F%23");
    for (const n of names) {
      const seg = sportStatsHref(n).slice("/stats/".length);
      expect(seg).not.toMatch(/[/?#&\s]/);
    }
  });

  it("carries the selected range through as a query param", () => {
    expect(sportStatsHref("Running", "90d")).toBe("/stats/Running?range=90d");
    expect(sportStatsHref("Running")).toBe("/stats/Running");
  });

  it("round-trips whether the router hands over the segment encoded or decoded", () => {
    for (const n of names) {
      const seg = sportStatsHref(n).slice("/stats/".length);
      expect(sportFromParam(seg)).toBe(n); // still percent-encoded
    }
    // already-decoded segments pass through, including a literal "%"
    expect(sportFromParam("HIIT/Circuit")).toBe("HIIT/Circuit");
    expect(sportFromParam("100% Effort")).toBe("100% Effort");
  });

  it("rejects a blank segment", () => {
    expect(sportFromParam("")).toBeNull();
    expect(sportFromParam("%20%20")).toBeNull();
  });
});

describe("resolveStatsRange", () => {
  it("defaults to the calendar year and honours known keys", () => {
    expect(resolveStatsRange(undefined, 2026, "2026-11-27")).toMatchObject({
      range: "year",
      start: "2026-01-01",
      end: "2026-11-27",
    });
    expect(resolveStatsRange("bogus", 2026, "2026-11-27").range).toBe("year");
    expect(resolveStatsRange("30d", 2026, "2026-11-27")).toMatchObject({
      start: "2026-10-29",
      end: "2026-11-27",
    });
    expect(resolveStatsRange("all", 2026, "2026-11-27").start).toBe("1970-01-01");
  });
});

describe("summarizeSportSessions", () => {
  it("sums duration and averages only sessions carrying each metric", () => {
    const s = summarizeSportSessions([
      { duration_sec: 3600, strain: 10, avg_hr: 140 },
      { duration_sec: 1800, strain: 14, avg_hr: null },
      { duration_sec: null, strain: null, avg_hr: 150 },
    ]);
    expect(s).toEqual({ sessions: 3, activeSeconds: 5400, avgStrain: 12, avgHr: 145 });
  });

  it("returns nulls (not zeros) for an empty list", () => {
    expect(summarizeSportSessions([])).toEqual({
      sessions: 0,
      activeSeconds: null,
      avgStrain: null,
      avgHr: null,
    });
  });
});
