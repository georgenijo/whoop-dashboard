import { describe, expect, it } from "vitest";
import {
  SPRINGS,
  baselinePosition,
  formatParsedDisplay,
  metricAccent,
  parseDisplayNumber,
  springProgress,
  springSettleTime,
} from "./motion";

describe("springProgress", () => {
  it("starts at rest and settles on the target", () => {
    for (const config of Object.values(SPRINGS)) {
      expect(springProgress(0, config)).toBe(0);
      expect(springProgress(springSettleTime(config), config)).toBeCloseTo(1, 2);
    }
  });

  it("never overshoots when critically damped, and does when bouncy", () => {
    let maxSmooth = 0;
    let maxBouncy = 0;
    for (let t = 0; t < 1.5; t += 0.01) {
      maxSmooth = Math.max(maxSmooth, springProgress(t, SPRINGS.smooth));
      maxBouncy = Math.max(maxBouncy, springProgress(t, SPRINGS.bouncy));
    }
    expect(maxSmooth).toBeLessThanOrEqual(1);
    expect(maxBouncy).toBeGreaterThan(1.01);
  });

  it("matches the settle times the CSS curves were sampled at", () => {
    expect(springSettleTime(SPRINGS.smooth)).toBeCloseTo(0.674, 1);
    expect(springSettleTime(SPRINGS.snappy)).toBeCloseTo(0.578, 1);
  });
});

describe("parseDisplayNumber", () => {
  it.each([
    ["78%", { prefix: "", value: 78, decimals: 0, suffix: "%" }],
    ["45.8 ms", { prefix: "", value: 45.8, decimals: 1, suffix: " ms" }],
    ["1,204 kJ", { prefix: "", value: 1204, decimals: 0, suffix: " kJ", grouped: true }],
    ["-3.25", { prefix: "", value: -3.25, decimals: 2, suffix: "" }],
    ["~57 bpm", { prefix: "~", value: 57, decimals: 0, suffix: " bpm" }],
  ])("parses %s", (display, expected) => {
    expect(parseDisplayNumber(display)).toMatchObject(expected);
  });

  it.each(["7h 12m", "6–8", "Fresh", ""])("leaves %s static", (display) => {
    expect(parseDisplayNumber(display)).toBeNull();
  });

  it("round-trips the original string at the final value", () => {
    for (const display of ["78%", "45.8 ms", "1,204 kJ", "~57 bpm", "0.50"]) {
      const parsed = parseDisplayNumber(display)!;
      expect(formatParsedDisplay(parsed, parsed.value)).toBe(display);
    }
  });

  it("keeps decimals and grouping stable mid-flight", () => {
    const parsed = parseDisplayNumber("1,204.5 kJ")!;
    expect(formatParsedDisplay(parsed, 12.345)).toBe("12.3 kJ");
    expect(formatParsedDisplay(parsed, 1000)).toBe("1,000.0 kJ");
  });
});

describe("metricAccent", () => {
  it.each([
    ["Recovery", "recovery"],
    ["HRV", "hrv"],
    ["Heart rate variability", "hrv"],
    ["Resting HR", "rhr"],
    ["Sleep performance", "sleep"],
    ["Day strain", "strain"],
    ["SpO2", "spo2"],
    ["Mood", "neutral"],
  ])("%s → %s", (label, accent) => {
    expect(metricAccent(label)).toBe(accent);
  });
});

describe("baselinePosition", () => {
  it("centres a value at its baseline and clamps extremes", () => {
    expect(baselinePosition(60, 60)).toBe(0.5);
    expect(baselinePosition(75, 60)).toBeCloseTo(0.75);
    expect(baselinePosition(500, 60)).toBe(1);
    expect(baselinePosition(-500, 60)).toBe(0);
  });

  it("returns null without both sides", () => {
    expect(baselinePosition(null, 60)).toBeNull();
    expect(baselinePosition(60, null)).toBeNull();
  });

  it("handles a zero baseline without dividing by zero", () => {
    expect(baselinePosition(0.5, 0)).toBeCloseTo(0.75);
  });
});
