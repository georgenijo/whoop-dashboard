// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { CycleRow, SleepRow } from "@/lib/db";
import { computeDeepSleepEfficiency, stageMinutesFromRow } from "./deepSleep";

const H = 3_600_000;

describe("computeDeepSleepEfficiency (unchanged by the stage helper)", () => {
  it("keeps its exact output shape and values", () => {
    const sleep = Array.from({ length: 8 }, (_, i) => ({
      date: `2026-11-${String(10 + i).padStart(2, "0")}`,
      deep_ms: (1 + i * 0.1) * H,
    })) as SleepRow[];
    const cycles = Array.from({ length: 9 }, (_, i) => ({
      date: `2026-11-${String(9 + i).padStart(2, "0")}`,
      strain: 10 + i,
    })) as CycleRow[];
    const out = computeDeepSleepEfficiency(sleep, cycles);
    expect(JSON.stringify(out[0])).toBe('{"date":"2026-11-10","deep_hrs":1,"prior_strain":10,"ratio":0.1}');
    expect(out).toHaveLength(8);
  });
  it("still returns [] under 7 rows", () => {
    expect(computeDeepSleepEfficiency([], [])).toEqual([]);
  });
});

describe("stageMinutesFromRow", () => {
  it("returns minutes or null", () => {
    expect(stageMinutesFromRow({ light_ms: 60_000, deep_ms: 120_000, rem_ms: 0, awake_ms: 0 })).toEqual({
      light: 1, deep: 2, rem: 0, awake: 0, total: 3,
    });
    expect(stageMinutesFromRow({ light_ms: null, deep_ms: 1, rem_ms: 1, awake_ms: 1 })).toBeNull();
    expect(stageMinutesFromRow({ light_ms: 1, deep_ms: Number.NaN, rem_ms: 1, awake_ms: 1 })).toBeNull();
    expect(stageMinutesFromRow({ light_ms: 0, deep_ms: 0, rem_ms: 0, awake_ms: 5 })).toBeNull();
  });
});
