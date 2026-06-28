// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  parseHrSeries,
  recoveryRate,
  timeAbovePct,
  trimp,
  type HrSeries,
} from "./workoutMetrics";

describe("parseHrSeries", () => {
  it("accepts a well-formed series and nulls out bad samples", () => {
    const s = parseHrSeries({
      interval_sec: 5,
      start_offset_sec: 0,
      bpm: [100, 0, -3, null, 120, "x"],
    });
    expect(s).not.toBeNull();
    expect(s!.bpm).toEqual([100, null, null, null, 120, null]);
  });

  it("rejects bad shapes", () => {
    expect(parseHrSeries(null)).toBeNull();
    expect(parseHrSeries({ interval_sec: 0, start_offset_sec: 0, bpm: [1] })).toBeNull();
    expect(parseHrSeries({ interval_sec: 5, start_offset_sec: -1, bpm: [1] })).toBeNull();
    expect(parseHrSeries({ interval_sec: 5, start_offset_sec: 0, bpm: [] })).toBeNull();
  });
});

describe("recoveryRate", () => {
  it("is negative when HR drops 60s after the final peak (good)", () => {
    // interval 10s → 6 steps == 60s. Peak (180) at index 6, value 60s later
    // (index 12) is 140 → 140-180 = -40.
    const bpm = [100, 110, 120, 130, 140, 150, 180, 170, 165, 160, 155, 150, 140];
    const s: HrSeries = { interval_sec: 10, start_offset_sec: 0, bpm };
    expect(recoveryRate(s)).toBe(-40);
  });

  it("returns null when the 60s window runs off the end", () => {
    const s: HrSeries = { interval_sec: 10, start_offset_sec: 0, bpm: [100, 120, 180] };
    expect(recoveryRate(s)).toBeNull();
  });

  it("returns null on empty/no-signal", () => {
    expect(recoveryRate(null)).toBeNull();
    expect(recoveryRate({ interval_sec: 5, start_offset_sec: 0, bpm: [null] })).toBeNull();
  });
});

describe("timeAbovePct", () => {
  it("counts seconds at/above the threshold", () => {
    // maxHr 200, 90% = 180. Samples >=180: 180,190,200 → 3 samples * 5s = 15s.
    const s: HrSeries = {
      interval_sec: 5,
      start_offset_sec: 0,
      bpm: [100, 180, 190, 200, 170, null],
    };
    expect(timeAbovePct(s, 200, 0.9)).toBe(15);
  });

  it("returns null on bad maxHr, 0 when never reached", () => {
    const s: HrSeries = { interval_sec: 5, start_offset_sec: 0, bpm: [100, 110] };
    expect(timeAbovePct(s, 0, 0.9)).toBeNull();
    expect(timeAbovePct(s, 200, 0.9)).toBe(0);
  });
});

describe("trimp", () => {
  it("accumulates a positive impulse and clamps HRr to [0,1]", () => {
    const s: HrSeries = {
      interval_sec: 60,
      start_offset_sec: 0,
      bpm: [60, 130, 200, 220], // 220 above max → clamped to HRr=1
    };
    const v = trimp(s, { rest: 60, max: 200 });
    expect(v).not.toBeNull();
    expect(v!).toBeGreaterThan(0);
    // Below-rest sample (60) contributes 0; clamped sample contributes the
    // HRr=1 term = 1min * 1 * 0.64 * e^1.92 ≈ 4.36.
    expect(v!).toBeGreaterThan(4);
  });

  it("returns null when bounds are invalid", () => {
    const s: HrSeries = { interval_sec: 5, start_offset_sec: 0, bpm: [100] };
    expect(trimp(s, { rest: 200, max: 100 })).toBeNull();
    expect(trimp(null, { rest: 50, max: 190 })).toBeNull();
  });
});
