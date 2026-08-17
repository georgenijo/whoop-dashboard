import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  computeBedtimePatterns,
  computeBedtimeRecoveryCorr,
  linearRegression,
} from "./bedtime";
import type { RecoveryRow } from "@/lib/db/recovery";
import type { SleepRow } from "@/lib/db/sleep";

function prevDateStr(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function nextDateStr(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * `wakeDate` is the sleep row's `.date` (issue #440: the WAKE day —
 * `sleepSummaryDate` keys on `end`, not `start`). `bedtimeHour` (0-23)
 * builds `start_local` on the evening BEFORE `wakeDate`, mirroring a real
 * midnight-spanning night — so `end_local` is never before `start_local`
 * on the same calendar day, and `date` always matches the day `end_local`
 * (and therefore the recovery row keyed on the same wake day) falls on.
 */
function sleep(
  wakeDate: string,
  bedtimeHour: number,
  overrides: Partial<SleepRow> = {},
): SleepRow {
  const hh = String(bedtimeHour).padStart(2, "0");
  return {
    date: wakeDate,
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
    start_local: `${prevDateStr(wakeDate)}T${hh}:00:00`,
    end_local: `${wakeDate}T07:00:00`,
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
    // x-variance.
    const hours = [21, 22, 23, 20, 21];
    const sleeps = dates.map((d, i) => sleep(d, hours[i]));
    // Recovery matching each sleep's OWN date directly.
    const ownDayScores = [60, 65, 55, 70, 62];
    const recoveries = dates.map((d, i) => recovery(d, ownDayScores[i]));
    // Also seed a "day after" recovery with DIFFERENT scores for every date
    // — if the lookup incorrectly used nextDate(s.date), it would find
    // these instead (or, for the last date, find nothing and drop the
    // point). Values are deliberately implausible (all 1) so a wrong join
    // is easy to detect.
    for (const d of dates) {
      recoveries.push(recovery(nextDateStr(d), 1));
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

  it("drops a sleep whose own date has no matching recovery row, without silently matching another date", () => {
    // 6 sleeps so that dropping exactly 1 (the one with no recovery row)
    // still clears the n>=5 threshold — unlike a 5-sleep/4-recovery setup,
    // where the result is null whether or not the drop logic is correct,
    // this can actually fail if the code matches the wrong date instead of
    // dropping.
    const dates = [
      "2026-04-20",
      "2026-04-21",
      "2026-04-22",
      "2026-04-23",
      "2026-04-24",
      "2026-04-25",
    ];
    const hours = [20, 21, 22, 20, 21, 22];
    const sleeps = dates.map((d, i) => sleep(d, hours[i]));
    const missingDate = "2026-04-22";
    // Varying scores — a regression needs nonzero variance on both axes, or
    // linearRegression (and therefore computeBedtimeRecoveryCorr) returns
    // null regardless of whether the drop logic is correct.
    const scores = [55, 60, 65, 70, 75, 80];
    const recoveries = dates
      .map((d, i) => ({ d, score: scores[i] }))
      .filter(({ d }) => d !== missingDate)
      .map(({ d, score }) => recovery(d, score));

    const result = computeBedtimeRecoveryCorr(sleeps, recoveries);

    expect(result).not.toBeNull();
    expect(result!.points).toHaveLength(5);
    expect(result!.points.map((p) => p.date)).not.toContain(missingDate);
  });

  it("returns null with fewer than 5 valid points", () => {
    const dates = ["2026-04-24", "2026-04-25", "2026-04-26"];
    const sleeps = dates.map((d, i) => sleep(d, 20 + i));
    const recoveries = dates.map((d) => recovery(d, 60));
    expect(computeBedtimeRecoveryCorr(sleeps, recoveries)).toBeNull();
  });
});

describe("computeBedtimePatterns", () => {
  it("returns null with fewer than 5 valid nights", () => {
    const sleeps = [sleep("2026-04-24", 22)];
    expect(computeBedtimePatterns(sleeps)).toBeNull();
  });

  it("computes weekday/weekend split using dayOfWeek(sleep.date)", () => {
    // 2026-04-25 is a Saturday, 2026-04-27..30 are Mon-Thu.
    const dates = ["2026-04-25", "2026-04-27", "2026-04-28", "2026-04-29", "2026-04-30"];
    const sleeps = dates.map((d) => sleep(d, 22));

    const result = computeBedtimePatterns(sleeps);

    expect(result).not.toBeNull();
    expect(result!.weekend.n).toBe(1);
    expect(result!.weekday.n).toBe(4);
  });

  // Issue #440 review, second pass, WARN 4 / bedDate plumbing: the tooltip
  // now shows the bed-side date (the evening BEFORE the wake day) alongside
  // the wake day for a midnight-spanning night.
  it("exposes bedDate as the day BEFORE the wake day for a midnight-spanning night", () => {
    const dates = ["2026-04-25", "2026-04-27", "2026-04-28", "2026-04-29", "2026-04-30"];
    const sleeps = dates.map((d) => sleep(d, 22));

    const result = computeBedtimePatterns(sleeps);

    expect(result).not.toBeNull();
    for (const point of result!.series) {
      expect(point.bedDate).toBe(prevDateStr(point.date));
    }
  });
});
