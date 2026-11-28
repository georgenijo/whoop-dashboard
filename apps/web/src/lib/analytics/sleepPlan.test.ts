import { afterEach, describe, expect, it, vi } from "vitest";
import type { RecoveryRow } from "@/lib/db/recovery";
import type { SleepRow } from "@/lib/db/sleep";
import {
  circularDiff,
  circularMedianMinutes,
  computeSleepPlan,
  formatClock,
  isSleepPlanEnabled,
  nightlyDebtMs,
  toNights,
  type OffsetAt,
  type SleepPlanReady,
} from "./sleepPlan";

const H = 3_600_000;
const FIXED_OFFSET: OffsetAt = () => -300; // EST, no DST

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function hhmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
}

type NightSpec = {
  /** Bedtime minutes relative to the bed day's 00:00 (may be ≥ 1440). */
  bed: number;
  wake: number; // minutes on wake day
  need?: number | null; // hours
  baseline?: number | null; // hours
  actual?: number | null; // hours asleep
  efficiency?: number | null;
};

/** Build a sleep row whose wake day is `date`. */
function row(date: string, spec: NightSpec): SleepRow {
  const bedDay = spec.bed >= 1440 ? date : addDays(date, -1);
  const actual = spec.actual === undefined ? 7.5 : spec.actual;
  return {
    date,
    in_bed_ms: 8 * H,
    light_ms: actual == null ? null : actual * 0.5 * H,
    deep_ms: actual == null ? null : actual * 0.25 * H,
    rem_ms: actual == null ? null : actual * 0.25 * H,
    awake_ms: 0.5 * H,
    sleep_need_ms: spec.need === undefined ? 8 * H : spec.need == null ? null : spec.need * H,
    performance: 90,
    efficiency: spec.efficiency === undefined ? 90 : spec.efficiency,
    consistency: 80,
    disturbances: 5,
    cycles: 4,
    respiratory_rate: 15,
    need_from_baseline_ms:
      spec.baseline === undefined ? 7.5 * H : spec.baseline == null ? null : spec.baseline * H,
    need_from_debt_ms: 0,
    need_from_strain_ms: 0,
    need_from_nap_ms: 0,
    start_local: `${bedDay}T${hhmm(spec.bed)}`,
    end_local: `${date}T${hhmm(spec.wake)}`,
  };
}

/** `n` nights ending with wake day `last`, all with the same spec. */
function series(last: string, n: number, spec: NightSpec | ((i: number) => NightSpec)): SleepRow[] {
  return Array.from({ length: n }, (_, i) =>
    row(addDays(last, i - n + 1), typeof spec === "function" ? spec(i) : spec),
  );
}

function ready(p: ReturnType<typeof computeSleepPlan>): SleepPlanReady {
  expect(p.status).toBe("ready");
  return p as SleepPlanReady;
}

const TONIGHT = "2026-11-20";

describe("flag", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("is off unless SLEEP_PLAN is exactly 1", () => {
    expect(isSleepPlanEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isSleepPlanEnabled({ SLEEP_PLAN: "true" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(isSleepPlanEnabled({ SLEEP_PLAN: "0" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    vi.stubEnv("SLEEP_PLAN", "1");
    expect(isSleepPlanEnabled()).toBe(true);
  });
});

describe("clock helpers", () => {
  it("takes the median across midnight, not around noon", () => {
    expect(circularMedianMinutes([23 * 60 + 50, 10, 20])).toBeCloseTo(10, 5);
    expect(circularMedianMinutes([23 * 60 + 40, 23 * 60 + 50, 20])).toBeCloseTo(23 * 60 + 50, 5);
    expect(circularMedianMinutes([])).toBeNull();
  });
  it("circularDiff returns the short way round", () => {
    expect(circularDiff(10, 1430)).toBe(20);
    expect(circularDiff(1430, 10)).toBe(-20);
  });
  it("formats 24h clocks and wraps", () => {
    expect(formatClock(22 * 60 + 45)).toBe("22:45");
    expect(formatClock(-15)).toBe("23:45");
    expect(formatClock(1440 + 30)).toBe("00:30");
    expect(formatClock(23 * 60 + 59.7)).toBe("00:00");
  });
});

describe("toNights", () => {
  it("drops nulls, unparsable stamps, non-positive and absurd spans", () => {
    const good = row("2026-11-10", { bed: 23 * 60, wake: 7 * 60 });
    const rows: SleepRow[] = [
      good,
      { ...good, date: "2026-11-11", start_local: null },
      { ...good, date: "2026-11-12", end_local: "garbage" },
      { ...good, date: "2026-11-13", start_local: "2026-11-13T08:00:00", end_local: "2026-11-13T07:00:00" },
      { ...good, date: "2026-11-14", start_local: "2026-11-12T08:00:00", end_local: "2026-11-14T07:00:00" },
    ];
    expect(toNights(rows).map((n) => n.date)).toEqual(["2026-11-10"]);
  });
  it("records the bed day separately from the wake day across midnight", () => {
    const [n] = toNights([row("2026-11-10", { bed: 23 * 60, wake: 7 * 60 })]);
    expect(n.bedDate).toBe("2026-11-09");
    const [m] = toNights([row("2026-11-10", { bed: 1440 + 30, wake: 8 * 60 })]);
    expect(m.bedDate).toBe("2026-11-10");
  });
});

describe("nightlyDebtMs", () => {
  it("matches SleepDebtChart: max(0, need − actual), zero without need", () => {
    expect(nightlyDebtMs(row("2026-11-10", { bed: 1380, wake: 420, need: 8, actual: 7 }))).toBeCloseTo(H);
    expect(nightlyDebtMs(row("2026-11-10", { bed: 1380, wake: 420, need: 7, actual: 8 }))).toBe(0);
    expect(nightlyDebtMs(row("2026-11-10", { bed: 1380, wake: 420, need: null }))).toBe(0);
    expect(nightlyDebtMs(row("2026-11-10", { bed: 1380, wake: 420, actual: null }))).toBe(0);
  });
});

describe("computeSleepPlan — data sufficiency", () => {
  it("empty data → insufficient with 0 nights", () => {
    expect(computeSleepPlan([], [], TONIGHT, FIXED_OFFSET)).toEqual({
      status: "insufficient",
      nights: 0,
      needed: 5,
    });
  });
  it("1 night → insufficient", () => {
    const p = computeSleepPlan(series(TONIGHT, 1, { bed: 1380, wake: 420 }), [], TONIGHT, FIXED_OFFSET);
    expect(p).toMatchObject({ status: "insufficient", nights: 1 });
  });
  it("4 nights → insufficient, 5 → ready", () => {
    expect(computeSleepPlan(series(TONIGHT, 4, { bed: 1380, wake: 420 }), [], TONIGHT, FIXED_OFFSET).status).toBe(
      "insufficient",
    );
    expect(computeSleepPlan(series(TONIGHT, 5, { bed: 1380, wake: 420 }), [], TONIGHT, FIXED_OFFSET).status).toBe(
      "ready",
    );
  });
  it("rows with null times don't count toward the minimum", () => {
    const rows = series(TONIGHT, 6, { bed: 1380, wake: 420 });
    rows[0].start_local = null;
    rows[1].end_local = null;
    expect(computeSleepPlan(rows, [], TONIGHT, FIXED_OFFSET)).toMatchObject({ status: "insufficient", nights: 4 });
  });
  it("ignores nights dated after tonight", () => {
    const rows = series(addDays(TONIGHT, 3), 7, { bed: 1380, wake: 420 });
    expect(computeSleepPlan(rows, [], TONIGHT, FIXED_OFFSET)).toMatchObject({ status: "insufficient", nights: 4 });
  });
  it("gaps in the calendar are fine — counts nights, not days", () => {
    const rows = [0, 3, 4, 9, 12].map((d) => row(addDays(TONIGHT, -d), { bed: 1380, wake: 420 }));
    expect(ready(computeSleepPlan(rows, [], TONIGHT, FIXED_OFFSET)).nights).toBe(5);
  });
});

describe("computeSleepPlan — bedtime maths", () => {
  it("no debt: bedtime = wake − baseline ÷ efficiency", () => {
    // baseline 7.5 h, efficiency 90% → 8h20m in bed; wake 06:30 → 22:10
    const p = ready(
      computeSleepPlan(series(TONIGHT, 10, { bed: 22 * 60 + 30, wake: 390, need: 7.5, actual: 7.5 }), [], TONIGHT, FIXED_OFFSET),
    );
    expect(formatClock(p.wakeMin)).toBe("06:30");
    expect(p.debtMs).toBe(0);
    expect(formatClock(p.bedtimeMin)).toBe("22:10");
    expect(formatClock(p.windDownMin)).toBe("21:25");
    expect(p.yieldSleepMs / H).toBeCloseTo(7.5, 5);
    expect(p.bedtimeAfterMidnight).toBe(false);
    expect(p.wakeDate).toBe("2026-11-21");
    expect(p.reason).toMatch(/^No meaningful sleep debt/);
    expect(p.irregular).toBe(false);
    expect(p.dstShiftMin).toBe(0);
  });

  it("debt adds a capped payback and is named in the reason", () => {
    // 7 nights × 0.2 h short = 1.4 h debt → payback 0.7 h
    const p = ready(
      computeSleepPlan(series(TONIGHT, 10, { bed: 1380, wake: 420, need: 8, actual: 7.8 }), [], TONIGHT, FIXED_OFFSET),
    );
    expect(p.debtMs / H).toBeCloseTo(1.4, 5);
    expect(p.paybackMs / H).toBeCloseTo(0.7, 5);
    expect(p.targetSleepMs / H).toBeCloseTo(8.2, 5);
    expect(p.reason).toMatch(/^Carrying 1\.4 h of sleep debt/);
    // large debt caps at 1 h
    const big = ready(
      computeSleepPlan(series(TONIGHT, 10, { bed: 1380, wake: 420, need: 8, actual: 6 }), [], TONIGHT, FIXED_OFFSET),
    );
    expect(big.paybackMs / H).toBe(1);
  });

  it("median wake time uses only the last 14 nights", () => {
    const rows = series(TONIGHT, 20, (i) => ({ bed: 1380, wake: i < 6 ? 600 : 420 }));
    expect(formatClock(ready(computeSleepPlan(rows, [], TONIGHT, FIXED_OFFSET)).wakeMin)).toBe("07:00");
  });

  it("wake times straddling midnight (night-shift) produce a sane median", () => {
    // 23:50 wakes start 16:00 the same day; 00:10 wakes start 16:00 the day before.
    const rows = series(TONIGHT, 7, (i) =>
      i % 2
        ? { bed: 1440 + 16 * 60, wake: 23 * 60 + 50, need: 7.5, actual: 7.5 }
        : { bed: 16 * 60, wake: 10, need: 7.5, actual: 7.5 },
    );
    const p = ready(computeSleepPlan(rows, [], TONIGHT, FIXED_OFFSET));
    expect(Math.abs(circularDiff(p.wakeMin, 0))).toBeLessThanOrEqual(10);
  });

  it("a late wake pushes the bedtime past midnight and flags it", () => {
    const p = ready(
      computeSleepPlan(series(TONIGHT, 7, { bed: 1440 + 90, wake: 10 * 60, need: 7.5, actual: 7.5 }), [], TONIGHT, FIXED_OFFSET),
    );
    expect(formatClock(p.bedtimeMin)).toBe("01:40");
    expect(p.bedtimeAfterMidnight).toBe(true);
    expect(formatClock(p.windDownMin)).toBe("00:55");
  });

  it("flags irregular schedules", () => {
    const wakes = [300, 600, 360, 660, 330, 630, 390];
    const p = ready(computeSleepPlan(series(TONIGHT, 7, (i) => ({ bed: 1380, wake: wakes[i] })), [], TONIGHT, FIXED_OFFSET));
    expect(p.irregular).toBe(true);
    expect(p.reason).toMatch(/varies by about ±\d+ min/);
  });

  it("missing sleep need falls back to sleep_need_ms, then to 8 h", () => {
    const noBaseline = ready(
      computeSleepPlan(series(TONIGHT, 7, { bed: 1380, wake: 420, baseline: null, need: 8, actual: 7 }), [], TONIGHT, FIXED_OFFSET),
    );
    expect(noBaseline.needSource).toBe("sleep_need");
    expect(noBaseline.paybackMs).toBe(0); // sleep_need already includes debt
    expect(noBaseline.targetSleepMs / H).toBe(8);

    const none = ready(
      computeSleepPlan(series(TONIGHT, 7, { bed: 1380, wake: 420, baseline: null, need: null }), [], TONIGHT, FIXED_OFFSET),
    );
    expect(none.needSource).toBe("default");
    expect(none.targetSleepMs / H).toBe(8);
    expect(none.reason).toMatch(/no Whoop sleep need on record/i);
  });

  it("missing efficiency falls back to actual ÷ in-bed, then clamps", () => {
    const p = ready(
      computeSleepPlan(series(TONIGHT, 7, { bed: 1380, wake: 420, efficiency: null, actual: 7.2 }), [], TONIGHT, FIXED_OFFSET),
    );
    expect(p.efficiency).toBeCloseTo(0.9, 5); // 7.2 / 8
    const low = ready(
      computeSleepPlan(series(TONIGHT, 7, { bed: 1380, wake: 420, efficiency: 40 }), [], TONIGHT, FIXED_OFFSET),
    );
    expect(low.efficiency).toBe(0.7);
  });
});

describe("computeSleepPlan — DST", () => {
  // US spring forward 2027-03-14 02:00 → 03:00 (EST −300 → EDT −240).
  const springOffset: OffsetAt = (date, min) =>
    date > "2027-03-14" || (date === "2027-03-14" && min >= 120) ? -240 : -300;
  // US fall back 2026-11-01 02:00 → 01:00 (EDT −240 → EST −300).
  const fallOffset: OffsetAt = (date, min) =>
    date > "2026-11-01" || (date === "2026-11-01" && min >= 60) ? -300 : -240;

  it("spring forward: bedtime moves 60 min earlier on the wall clock to keep the same sleep", () => {
    const tonight = "2027-03-13";
    const rows = series(tonight, 7, { bed: 1380, wake: 420, need: 7.5, actual: 7.5 });
    const normal = ready(computeSleepPlan(rows, [], tonight, FIXED_OFFSET));
    const dst = ready(computeSleepPlan(rows, [], tonight, springOffset));
    expect(dst.dstShiftMin).toBe(60);
    expect(circularDiff(normal.bedtimeMin, dst.bedtimeMin)).toBe(60);
    expect(dst.timeInBedMs).toBeCloseTo(normal.timeInBedMs, 5);
    expect(dst.reason).toContain("clocks go forward tonight");
  });

  it("fall back: bedtime moves 60 min later", () => {
    const tonight = "2026-10-31";
    const rows = series(tonight, 7, { bed: 1380, wake: 420, need: 7.5, actual: 7.5 });
    const dst = ready(computeSleepPlan(rows, [], tonight, fallOffset));
    expect(dst.dstShiftMin).toBe(-60);
    expect(formatClock(dst.bedtimeMin)).toBe("23:40"); // 22:40 + 60
    expect(dst.reason).toContain("clocks go back tonight");
  });
});

describe("computeSleepPlan — recovery relationship", () => {
  function rec(rows: SleepRow[], score: (i: number) => number): RecoveryRow[] {
    return rows.map((r, i) => ({ date: r.date, recovery_score: score(i) }) as unknown as RecoveryRow);
  }

  it("earlier bedtimes with higher recovery pull the plan earlier (≤60 min)", () => {
    // Alternate 21:30 (rec 85) and 00:30 (rec 40), wake 07:00, need 7.5 h → raw 22:40.
    const rows = series(TONIGHT, 14, (i) => ({
      bed: i % 2 ? 21 * 60 + 30 : 1440 + 30,
      wake: 420,
      need: 7.5,
      actual: 7.5,
    }));
    const p = ready(computeSleepPlan(rows, rec(rows, (i) => (i % 2 ? 85 : 40)), TONIGHT, FIXED_OFFSET));
    expect(p.recoveryBedtimeMin).not.toBeNull();
    expect(formatClock(p.recoveryBedtimeMin!)).toBe("21:30");
    expect(formatClock(p.bedtimeMin)).toBe("21:40"); // capped at 60 min pull
    expect(p.yieldSleepMs / H).toBeCloseTo(8.4, 5);
    expect(p.reason).toContain("your recovery is highest when you are in bed before 21:30");
  });

  it("no pull when later bedtimes don't hurt recovery", () => {
    const rows = series(TONIGHT, 14, (i) => ({ bed: i % 2 ? 21 * 60 + 30 : 1440 + 30, wake: 420 }));
    const p = ready(computeSleepPlan(rows, rec(rows, (i) => (i % 2 ? 40 : 85)), TONIGHT, FIXED_OFFSET));
    expect(p.recoveryBedtimeMin).toBeNull();
  });

  it("tolerates null recovery scores", () => {
    const rows = series(TONIGHT, 7, { bed: 1380, wake: 420 });
    const recovery = rows.map((r) => ({ date: r.date, recovery_score: null }) as unknown as RecoveryRow);
    expect(ready(computeSleepPlan(rows, recovery, TONIGHT, FIXED_OFFSET)).recoveryBedtimeMin).toBeNull();
  });
});

describe("computeSleepPlan — strip", () => {
  it("lists the last 7 bedtimes with signed delta vs plan across midnight", () => {
    const rows = series(TONIGHT, 10, (i) => ({ bed: i === 9 ? 1440 + 10 : 22 * 60 + 10, wake: 390, need: 7.5, actual: 7.5 }));
    const p = ready(computeSleepPlan(rows, [], TONIGHT, FIXED_OFFSET));
    expect(p.strip).toHaveLength(7);
    expect(p.strip.at(-1)!.date).toBe(TONIGHT);
    expect(p.strip.at(-1)!.deltaMin).toBe(120); // 00:10 vs 22:10
    expect(p.strip[0].deltaMin).toBe(0);
  });
});

describe("serverOffsetAt", () => {
  it("returns minutes east of UTC for the server zone", async () => {
    const { serverOffsetAt } = await import("./sleepPlan");
    const v = serverOffsetAt("2026-06-01", 600);
    expect(Number.isInteger(v)).toBe(true);
    expect(Math.abs(v)).toBeLessThanOrEqual(14 * 60);
  });
});
