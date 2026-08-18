import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { computeNapImpact, withStartHour } from "./naps";
import type { NapRow, SleepRow } from "@/lib/db";

function nap(date: string, overrides: Partial<NapRow> = {}): NapRow {
  return {
    date,
    duration_ms: 20 * 60_000,
    performance: null,
    efficiency: null,
    light_ms: 10 * 60_000,
    deep_ms: 5 * 60_000,
    rem_ms: 5 * 60_000,
    awake_ms: 0,
    start_local: `${date}T14:00:00`,
    end_local: `${date}T14:20:00`,
    ...overrides,
  };
}

function prevDateStr(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// `date` is the WAKE day (issue #440). Default `start_local`/`end_local`
// mirror a real midnight-spanning night — bed the evening BEFORE `date`,
// wake on `date` itself — so `end_local` is never before `start_local` on
// the same calendar day (this function doesn't use either field, but a
// self-contradictory fixture is bad documentation of the contract these
// tests establish).
function sleep(date: string, overrides: Partial<SleepRow> = {}): SleepRow {
  return {
    date,
    in_bed_ms: 8 * 3_600_000,
    light_ms: 4 * 3_600_000,
    deep_ms: 1.5 * 3_600_000,
    rem_ms: 2 * 3_600_000,
    awake_ms: 30 * 60_000,
    sleep_need_ms: 8 * 3_600_000,
    performance: 90,
    efficiency: 92,
    consistency: 80,
    disturbances: 3,
    cycles: 5,
    respiratory_rate: 14.5,
    need_from_baseline_ms: 8 * 3_600_000,
    need_from_debt_ms: 0,
    need_from_strain_ms: 0,
    need_from_nap_ms: null,
    start_local: `${prevDateStr(date)}T23:00:00`,
    end_local: `${date}T07:00:00`,
    ...overrides,
  };
}

describe("computeNapImpact (issue #440 — nap-to-night join)", () => {
  // Issue #440 review, BLOCK 2: the night sleep Whoop credits for a nap on
  // date D is the sleep that starts the evening of D and ends the morning
  // of D+1. Under wake-day attribution that night is now DATED D+1, not D
  // — so the join must match sleep.date === nextDate(nap.date), not
  // sleep.date === nap.date.
  it("credits the night sleep dated the day AFTER the nap, not the nap's own date", () => {
    const naps = [nap("2026-04-28", { light_ms: 15 * 60_000, deep_ms: 0, rem_ms: 0 })];
    const sleeps = [
      // The night that starts the evening of the nap and ends the next
      // morning — now dated 2026-04-29 (wake day).
      sleep("2026-04-29", { need_from_nap_ms: -1_800_000, performance: 88 }),
      // An unrelated night with no nap before it.
      sleep("2026-04-27", { need_from_nap_ms: null, performance: 70 }),
    ];

    const result = computeNapImpact(naps, sleeps);

    expect(result.totalNaps).toBe(1);
    // The credited night (2026-04-29) reduced sleep need by 1_800_000ms = 0.5h.
    expect(result.avgSleepNeedReductionHrs).toBeCloseTo(0.5, 6);
    expect(result.withNap.n).toBe(1);
    expect(result.withNap.perf).toBe(88);
    expect(result.withoutNap.n).toBe(1);
    expect(result.withoutNap.perf).toBe(70);
  });

  it("does NOT match the night sleep dated the SAME day as the nap (the pre-fix behavior)", () => {
    const naps = [nap("2026-04-28")];
    const sleeps = [
      // Same-date sleep — this is what the old (bed-day) join incorrectly
      // matched. Post-fix it must land in withoutNap, not withNap.
      sleep("2026-04-28", { need_from_nap_ms: -1_800_000 }),
    ];

    const result = computeNapImpact(naps, sleeps);

    expect(result.withNap.n).toBe(0);
    expect(result.withoutNap.n).toBe(1);
    expect(result.avgSleepNeedReductionHrs).toBeNull();
  });

  it("returns null avgSleepNeedReductionHrs when there are no negative nap credits", () => {
    const naps = [nap("2026-04-28")];
    const sleeps = [sleep("2026-04-29", { need_from_nap_ms: null })];

    const result = computeNapImpact(naps, sleeps);

    expect(result.avgSleepNeedReductionHrs).toBeNull();
  });

  it("averages nap duration across all naps regardless of matching", () => {
    const naps = [
      nap("2026-04-28", { light_ms: 10 * 60_000, deep_ms: 0, rem_ms: 0 }),
      nap("2026-04-29", { light_ms: 20 * 60_000, deep_ms: 0, rem_ms: 0 }),
    ];

    const result = computeNapImpact(naps, []);

    expect(result.totalNaps).toBe(2);
    expect(result.avgDurationMin).toBe(15);
  });

  it("handles zero naps without throwing", () => {
    const result = computeNapImpact([], [sleep("2026-04-28")]);
    expect(result.totalNaps).toBe(0);
    expect(result.avgDurationMin).toBe(0);
    expect(result.withNap.n).toBe(0);
    expect(result.withoutNap.n).toBe(1);
  });
});

describe("withStartHour", () => {
  it("parses the local start hour from start_local", () => {
    const [result] = withStartHour([nap("2026-04-28", { start_local: "2026-04-28T14:30:00" })]);
    expect(result.start_hour).toBeCloseTo(14.5, 6);
  });

  it("returns null start_hour when start_local is missing", () => {
    const [result] = withStartHour([nap("2026-04-28", { start_local: null })]);
    expect(result.start_hour).toBeNull();
  });
});
