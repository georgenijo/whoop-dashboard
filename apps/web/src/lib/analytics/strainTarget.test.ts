import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { RecoveryRow } from "@/lib/db";
import {
  MAX_RECOVERY_FALLBACK_DAYS,
  MIN_HISTORY_DAYS,
  STRAIN_ZONES,
  computeStrainTarget,
  daysBetween,
  isStrainTargetEnabled,
  strainProgress,
  todayStrainSoFar,
} from "./strainTarget";
import { computeTrainingLoad } from "./trainingLoad";

const TODAY = "2026-11-27";

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** N consecutive days ending at `end` (inclusive). */
function days(n: number, end = TODAY): string[] {
  return Array.from({ length: n }, (_, i) => shift(end, i - (n - 1)));
}

function rec(date: string, score: number | null, extra: Partial<RecoveryRow> = {}): RecoveryRow {
  return { date, recovery_score: score, hrv: 60, rhr: 52, spo2: 96, skin_temp: 33.5, ...extra };
}

/** Steady history: N prior days at `strain`, plus today's recovery score. */
function steady(score: number, strain: number, n = 60) {
  const prior = days(n, shift(TODAY, -1));
  return {
    today: TODAY,
    recovery: [...prior.map((d) => rec(d, 60)), rec(TODAY, score)],
    cycles: prior.map((d) => ({ date: d, strain })),
  };
}

const zone = (id: string) => STRAIN_ZONES.find((z) => z.id === id)!;

describe("isStrainTargetEnabled", () => {
  it("is on only for exactly '1'", () => {
    expect(isStrainTargetEnabled({})).toBe(false);
    expect(isStrainTargetEnabled({ STRAIN_TARGET: "0" })).toBe(false);
    expect(isStrainTargetEnabled({ STRAIN_TARGET: "true" })).toBe(false);
    expect(isStrainTargetEnabled({ STRAIN_TARGET: "1" })).toBe(true);
  });
});

describe("computeStrainTarget — recovery band", () => {
  it("maps high/mid/low recovery to push/maintain/restore on steady load", () => {
    for (const [score, id] of [[85, "push"], [50, "maintain"], [20, "restore"]] as const) {
      // Steady 13 → TSB ≈ 0, avg7 13: no adjustment fires.
      const t = computeStrainTarget(steady(score, 13));
      expect(t.status).toBe("ok");
      if (t.status !== "ok") continue;
      expect(t.zone.id).toBe(id);
      expect([t.low, t.high]).toEqual([zone(id).low, zone(id).high]);
      expect(t.recoveryAgeDays).toBe(0);
      expect(t.cap).toBeNull();
      expect(t.limitedHistory).toBe(false);
      expect(t.reason).toMatch(new RegExp(`^Recovery ${score}% today`));
    }
  });

  it("uses band edges from recoveryBand (67 high, 34 mid)", () => {
    const at = (s: number) => {
      const t = computeStrainTarget(steady(s, 13));
      return t.status === "ok" ? t.zone.id : null;
    };
    expect(at(67)).toBe("push");
    expect(at(66)).toBe("maintain");
    expect(at(34)).toBe("maintain");
    expect(at(33)).toBe("restore");
  });
});

describe("computeStrainTarget — empty / sparse data", () => {
  it("returns unavailable with no recovery at all", () => {
    const t = computeStrainTarget({ today: TODAY, recovery: [], cycles: [] });
    expect(t.status).toBe("unavailable");
  });

  it("returns unavailable when every recovery score is null", () => {
    const t = computeStrainTarget({
      today: TODAY,
      recovery: days(5).map((d) => rec(d, null)),
      cycles: [],
    });
    expect(t.status).toBe("unavailable");
  });

  it("works with 1 day of data (today's recovery, no strain history)", () => {
    const t = computeStrainTarget({ today: TODAY, recovery: [rec(TODAY, 80)], cycles: [] });
    expect(t.status).toBe("ok");
    if (t.status !== "ok") return;
    expect(t.zone.id).toBe("push");
    expect(t.limitedHistory).toBe(true);
    expect(t.avg7).toBeNull();
    expect(t.tsb).toBeNull();
    expect(t.reason).toContain("0 days of strain history");
  });

  it("flags limited history below MIN_HISTORY_DAYS and skips load adjustments", () => {
    const prior = days(MIN_HISTORY_DAYS - 1, shift(TODAY, -1));
    // Huge recent load would normally step down; limited history ignores it.
    const t = computeStrainTarget({
      today: TODAY,
      recovery: [rec(TODAY, 90)],
      cycles: prior.map((d) => ({ date: d, strain: 20 })),
    });
    expect(t.status).toBe("ok");
    if (t.status !== "ok") return;
    expect(t.limitedHistory).toBe(true);
    expect(t.zone.id).toBe("push");
    expect(t.reason).toContain(`${MIN_HISTORY_DAYS - 1} days of strain history`);
  });

  it("ignores null strains when counting history and averaging", () => {
    const prior = days(10, shift(TODAY, -1));
    const t = computeStrainTarget({
      today: TODAY,
      recovery: [rec(TODAY, 50)],
      cycles: prior.map((d, i) => ({ date: d, strain: i % 2 === 0 ? null : 10 })),
    });
    expect(t.status).toBe("ok");
    if (t.status !== "ok") return;
    expect(t.limitedHistory).toBe(true); // only 5 non-null days
    expect(t.avg7).toBe(10);
  });

  it("averages only the last 7 days, tolerating gaps", () => {
    const cycles = [
      { date: shift(TODAY, -30), strain: 2 },
      { date: shift(TODAY, -20), strain: 2 },
      { date: shift(TODAY, -15), strain: 2 },
      { date: shift(TODAY, -12), strain: 2 },
      { date: shift(TODAY, -10), strain: 2 },
      { date: shift(TODAY, -6), strain: 12 },
      { date: shift(TODAY, -2), strain: 14 },
    ];
    const t = computeStrainTarget({ today: TODAY, recovery: [rec(TODAY, 50)], cycles });
    expect(t.status).toBe("ok");
    if (t.status !== "ok") return;
    expect(t.avg7).toBe(13);
  });
});

describe("computeStrainTarget — fallback recovery", () => {
  it("falls back to yesterday when today is unscored, and says so", () => {
    const base = steady(50, 13);
    base.recovery = [...base.recovery.slice(0, -2), rec(shift(TODAY, -1), 80), rec(TODAY, null)];
    const t = computeStrainTarget(base);
    expect(t.status).toBe("ok");
    if (t.status !== "ok") return;
    expect(t.recoveryDate).toBe(shift(TODAY, -1));
    expect(t.recoveryAgeDays).toBe(1);
    expect(t.recoveryScore).toBe(80);
    expect(t.reason).toContain("yesterday (no scored recovery yet today)");
  });

  it("falls back up to MAX_RECOVERY_FALLBACK_DAYS, then gives up", () => {
    const ok = computeStrainTarget({
      today: TODAY,
      recovery: [rec(shift(TODAY, -MAX_RECOVERY_FALLBACK_DAYS), 70)],
      cycles: [],
    });
    expect(ok.status).toBe("ok");
    if (ok.status === "ok") expect(ok.reason).toContain(`${MAX_RECOVERY_FALLBACK_DAYS} days ago`);

    const stale = computeStrainTarget({
      today: TODAY,
      recovery: [rec(shift(TODAY, -(MAX_RECOVERY_FALLBACK_DAYS + 1)), 70)],
      cycles: [],
    });
    expect(stale.status).toBe("unavailable");
    if (stale.status === "unavailable") expect(stale.reason).toContain("too stale");
  });

  it("ignores future-dated rows (timezone skew)", () => {
    const t = computeStrainTarget({
      today: TODAY,
      recovery: [rec(TODAY, 20), rec(shift(TODAY, 1), 95)],
      cycles: [{ date: shift(TODAY, 1), strain: 21 }],
    });
    expect(t.status).toBe("ok");
    if (t.status === "ok") expect(t.zone.id).toBe("restore");
  });

  it("does not depend on input order", () => {
    const base = steady(85, 13);
    const a = computeStrainTarget(base);
    const b = computeStrainTarget({
      ...base,
      recovery: [...base.recovery].reverse(),
      cycles: [...base.cycles].reverse(),
    });
    expect(b).toEqual(a);
  });

  it("handles month and year boundaries", () => {
    const t = computeStrainTarget({
      today: "2027-01-01",
      recovery: [rec("2026-12-30", 75)],
      cycles: [],
    });
    expect(t.status).toBe("ok");
    if (t.status === "ok") expect(t.recoveryAgeDays).toBe(2);
  });
});

describe("computeStrainTarget — training load", () => {
  it("steps down a zone when fatigued (TSB below threshold)", () => {
    // 50 easy days then a hard week → ATL ≫ CTL.
    const prior = days(57, shift(TODAY, -1));
    const cycles = prior.map((d, i) => ({ date: d, strain: i < 50 ? 10 : 17 }));
    const t = computeStrainTarget({ today: TODAY, recovery: [rec(TODAY, 85)], cycles });
    expect(t.status).toBe("ok");
    if (t.status !== "ok") return;
    expect(t.tsb!).toBeLessThan(-2);
    expect(t.zone.id).toBe("build");
    expect(t.reason).toContain("recent load is ahead of your base");
  });

  it("steps a mid-recovery day up a zone when fresh", () => {
    const prior = days(57, shift(TODAY, -1));
    const cycles = prior.map((d, i) => ({ date: d, strain: i < 50 ? 14 : 8 }));
    const t = computeStrainTarget({ today: TODAY, recovery: [rec(TODAY, 55)], cycles });
    expect(t.status).toBe("ok");
    if (t.status !== "ok") return;
    expect(t.tsb!).toBeGreaterThan(2);
    expect(t.zone.id).toBe("build");
    expect(t.reason).toContain("you're fresh");
  });

  it("never steps a low-recovery day up, even when fresh", () => {
    const prior = days(57, shift(TODAY, -1));
    const cycles = prior.map((d, i) => ({ date: d, strain: i < 50 ? 14 : 8 }));
    const t = computeStrainTarget({ today: TODAY, recovery: [rec(TODAY, 20)], cycles });
    expect(t.status === "ok" && t.zone.id).toBe("restore");
  });

  it("applies the ramp guard when push is far above the weekly average", () => {
    const t = computeStrainTarget(steady(90, 6));
    expect(t.status).toBe("ok");
    if (t.status !== "ok") return;
    expect(t.zone.id).toBe("build");
    expect(t.reason).toContain("ramping up from a 6.0 weekly average");
  });

  it("excludes today's in-progress cycle from load", () => {
    const base = steady(85, 13);
    const withToday = { ...base, cycles: [...base.cycles, { date: TODAY, strain: 0.5 }] };
    const a = computeStrainTarget(base);
    const b = computeStrainTarget(withToday);
    expect(b).toEqual(a);
  });
});

describe("computeStrainTarget — illness / overtraining caps", () => {
  it("caps at restore when illness signals fire on the recovery day", () => {
    const base = steady(85, 13);
    base.recovery = [
      ...base.recovery.slice(0, -1),
      rec(TODAY, 85, { rhr: 60, hrv: 40, skin_temp: 34.5 }),
    ];
    const t = computeStrainTarget(base);
    expect(t.status).toBe("ok");
    if (t.status !== "ok") return;
    expect(t.cap).toBe("illness");
    expect(t.zone.id).toBe("restore");
    expect(t.reason).toContain("off baseline");
  });

  it("caps at maintain under a high overtraining score", () => {
    const prior = days(30, shift(TODAY, -1));
    const recovery = prior.map((d, i) => {
      const k = Math.max(0, i - 22); // last 7 days trend badly
      return rec(d, 80 - k * 2, { hrv: 62 - k * 0.8, rhr: 50 + k * 0.3 });
    });
    recovery.push(rec(TODAY, 70, { hrv: 57, rhr: 52 }));
    const cycles = prior.map((d) => ({ date: d, strain: 13 }));
    const t = computeStrainTarget({ today: TODAY, recovery, cycles });
    expect(t.status).toBe("ok");
    if (t.status !== "ok") return;
    expect(t.cap).toBe("overtraining");
    expect(t.zone.id).toBe("maintain");
    expect(t.reason).toContain("overreaching");
  });
});

describe("strainProgress", () => {
  it("classifies against the range, inclusive of edges", () => {
    expect(strainProgress(null, 8, 12)).toBe("none");
    expect(strainProgress(Number.NaN, 8, 12)).toBe("none");
    expect(strainProgress(0, 8, 12)).toBe("below");
    expect(strainProgress(8, 8, 12)).toBe("in");
    expect(strainProgress(12, 8, 12)).toBe("in");
    expect(strainProgress(12.1, 8, 12)).toBe("above");
  });
});

describe("todayStrainSoFar", () => {
  it("prefers today's cycle strain", () => {
    expect(
      todayStrainSoFar(TODAY, [{ date: TODAY, strain: 9.4 }], [{ strain: 12 }]),
    ).toEqual({ value: 9.4, source: "cycle" });
  });
  it("falls back to the hardest workout as a lower bound", () => {
    expect(
      todayStrainSoFar(TODAY, [{ date: TODAY, strain: null }], [{ strain: 6 }, { strain: null }, { strain: 11 }]),
    ).toEqual({ value: 11, source: "workouts" });
  });
  it("returns null when nothing is recorded", () => {
    expect(todayStrainSoFar(TODAY, [{ date: shift(TODAY, -1), strain: 14 }], [])).toEqual({
      value: null,
      source: null,
    });
  });
});

describe("daysBetween", () => {
  it("is DST-safe", () => {
    // US DST ends 2026-11-01; Europe 2026-10-25.
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween(TODAY, TODAY)).toBe(0);
  });
});

describe("computeTrainingLoad", () => {
  it("is empty for empty input and flat for constant strain", () => {
    expect(computeTrainingLoad([])).toEqual([]);
    const flat = computeTrainingLoad(days(10).map((d) => ({ date: d, strain: 10 })));
    expect(flat.at(-1)!.tsb).toBeCloseTo(0);
  });
  it("treats null strain as 0", () => {
    const out = computeTrainingLoad([
      { date: "2026-01-01", strain: 10 },
      { date: "2026-01-02", strain: null },
    ]);
    expect(out[1].atl).toBeLessThan(10);
    expect(out[1].tsb).toBeGreaterThan(0);
  });
});
