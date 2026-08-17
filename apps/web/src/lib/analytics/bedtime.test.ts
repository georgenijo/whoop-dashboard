import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  computeBedtimePatterns,
  computeBedtimeRecoveryCorr,
  linearRegression,
} from "./bedtime";
import type { RecoveryRow } from "@/lib/db/recovery";
import type { SleepRow } from "@/lib/db/sleep";

function sleep(date: string, startLocal: string, overrides: Partial<SleepRow> = {}): SleepRow {
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
    start_local: startLocal,
    end_local: `${date}T07:00:00`,
    ...overrides,
  };
}

function recovery(date: string, score: number): RecoveryRow {
  return { date, recovery_score: score, hrv: null, rhr: null, spo2: null, skin_temp: null };
}

describe("linearRegression", () => {
  it("returns null for fewer than 2 points", () => {
    expect(linearRegression([])).toBeNull();
    expect(linearRegression([{ x: 1, y: 1 }])).toBeNull();
  });

  it("computes slope/intercept/correlation for a perfect line", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 4 },
    ];
    const reg = linearRegression(points)!;
    expect(reg.slope).toBeCloseTo(2, 6);
    expect(reg.intercept).toBeCloseTo(0, 6);
    expect(reg.correlation).toBeCloseTo(1, 6);
  });

  it("returns null when x has zero variance", () => {
    expect(linearRegression([{ x: 5, y: 1 }, { x: 5, y: 2 }])).toBeNull();
  });
});

// Issue #440 review, BLOCK 1: `computeBedtimeRecoveryCorr` used to look up
// `recoveryByDate.get(nextDate(s.date))` because `s.date` was the BED day
// and recovery landed the following day. Now that `s.date` IS the wake day
// (== recovery.date, since both key off the sleep ending), the lookup must
// be direct — `recoveryByDate.get(s.date)`. Left as `nextDate` post-fix,
// this would pair every night's bedtime with the FOLLOWING night's recovery
// instead of its own, on 100% of nights.
describe("computeBedtimeRecoveryCorr", () => {
  it("pairs each sleep's own date's recovery, not the day-after's", () => {
    // Every-other-day dates so "day after" sentinels (below) never collide
    // with an own-day date — a collision would let a wrong join accidentally
    // read the right value and mask the bug this test exists to catch.
    const dates = [
      "2026-04-20",
      "2026-04-22",
      "2026-04-24",
      "2026-04-26",
      "2026-04-28",
    ];
    // Deliberately varying bedtime hour so linearRegression has non-zero
    // x-variance. start_local hour cycles 21,22,23,20,21 (pre-midnight, so
    // parseLocalParts' date component equals the sleep's own date — this is
    // about the RECOVERY lookup, not the bedtime-hour parsing).
    const hours = [21, 22, 23, 20, 21];
    const sleeps = dates.map((d, i) => sleep(d, `${d}T${String(hours[i]).padStart(2, "0")}:00:00`));
    // Recovery matching each sleep's OWN date directly.
    const ownDayScores = [60, 65, 55, 70, 62];
    const recoveries = dates.map((d, i) => recovery(d, ownDayScores[i]));
    // Also seed a "day after" recovery with DIFFERENT scores for every date
    // — if the lookup incorrectly used nextDate(s.date), it would find
    // these instead (or, for the last date, find nothing and drop the
    // point). Values are deliberately implausible (all 1) so a wrong join
    // is easy to detect.
    for (const d of dates) {
      const after = new Date(d + "T00:00:00Z");
      after.setUTCDate(after.getUTCDate() + 1);
      recoveries.push(recovery(after.toISOString().slice(0, 10), 1));
    }

    const result = computeBedtimeRecoveryCorr(sleeps, recoveries);

    expect(result).not.toBeNull();
    expect(result!.points).toHaveLength(5);
    // Every point's recovery must be the sleep's OWN date's score (60..70
    // range), never the "day after" sentinel value of 1.
    for (const p of result!.points) {
      expect(p.recovery).not.toBe(1);
      expect(ownDayScores).toContain(p.recovery);
    }
  });

  it("drops a sleep when its own date has no matching recovery row", () => {
    const dates = ["2026-04-24", "2026-04-25", "2026-04-26", "2026-04-27", "2026-04-28"];
    const sleeps = dates.map((d, i) =>
      sleep(d, `${d}T${String(20 + (i % 4)).padStart(2, "0")}:00:00`),
    );
    // Only 4 of 5 dates have a recovery row — the 5th sleep must be
    // excluded, not silently matched to some other date.
    const recoveries = dates.slice(0, 4).map((d) => recovery(d, 60));

    const result = computeBedtimeRecoveryCorr(sleeps, recoveries);

    // Only 4 valid pairs — below the n>=5 threshold — so the function
    // returns null rather than a regression built on too little data.
    expect(result).toBeNull();
  });

  it("returns null with fewer than 5 valid points", () => {
    const dates = ["2026-04-24", "2026-04-25", "2026-04-26"];
    const sleeps = dates.map((d, i) => sleep(d, `${d}T${20 + i}:00:00`));
    const recoveries = dates.map((d) => recovery(d, 60));
    expect(computeBedtimeRecoveryCorr(sleeps, recoveries)).toBeNull();
  });
});

describe("computeBedtimePatterns", () => {
  it("returns null with fewer than 5 valid nights", () => {
    const sleeps = [sleep("2026-04-24", "2026-04-24T22:00:00")];
    expect(computeBedtimePatterns(sleeps)).toBeNull();
  });

  it("computes weekday/weekend split using dayOfWeek(sleep.date)", () => {
    // 2026-04-25 is a Saturday, 2026-04-27..30 are Mon-Thu. Each night spans
    // midnight (bed 22:00, wake 06:00 the next calendar day) so sleepHrs
    // comes out positive (~8h) rather than being filtered by the <=0 guard.
    const dates = ["2026-04-25", "2026-04-27", "2026-04-28", "2026-04-29", "2026-04-30"];
    const sleeps = dates.map((d) => {
      const wake = new Date(d + "T00:00:00Z");
      wake.setUTCDate(wake.getUTCDate() + 1);
      const wakeDate = wake.toISOString().slice(0, 10);
      return sleep(d, `${d}T22:00:00`, { end_local: `${wakeDate}T06:00:00` });
    });

    const result = computeBedtimePatterns(sleeps);

    expect(result).not.toBeNull();
    expect(result!.weekend.n).toBe(1);
    expect(result!.weekday.n).toBe(4);
  });
});
