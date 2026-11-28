import { describe, expect, it } from "vitest";
import {
  MIN_PAIRED_DAYS,
  computeRecoveryDrivers,
  isRecoveryDriversEnabled,
  strengthLabel,
  type DriverFinding,
  type RecoveryDriversInput,
} from "./recoveryDrivers";
import { shiftDate } from "@/lib/range";

/** Deterministic PRNG (mulberry32) so fixtures never flake. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const H = 3_600_000;

type Opts = {
  days?: number;
  end?: string;
  seed?: number;
  /** recovery points per hour of sleep above 6.5 h */
  sleepEffect?: number;
  /** recovery points per unit of previous-day strain above 10 */
  strainEffect?: number;
  noise?: number;
};

function fixture(o: Opts = {}): RecoveryDriversInput {
  const { days = 60, end = "2026-11-27", seed = 1, sleepEffect = 0, strainEffect = 0, noise = 4 } = o;
  const r = rng(seed);
  const out: RecoveryDriversInput = { recovery: [], sleep: [], cycles: [], workouts: [] };
  const strainBy = new Map<string, number>();
  // cycles for every day including one before the first recovery
  for (let i = days; i >= 0; i--) {
    const d = shiftDate(end, -i);
    const strain = 6 + r() * 10;
    strainBy.set(d, strain);
    out.cycles.push({ date: d, strain });
    if (r() < 0.5) out.workouts.push({ date: d });
  }
  for (let i = days - 1; i >= 0; i--) {
    const d = shiftDate(end, -i);
    const hours = 5.5 + r() * 3;
    const deep = hours * 0.2;
    const rem = hours * 0.22;
    const light = hours - deep - rem;
    const bedMin = 22 * 60 + 30 + Math.round((r() - 0.5) * 60);
    const bh = Math.floor(bedMin / 60) % 24;
    const bm = bedMin % 60;
    out.sleep.push({
      date: d,
      light_ms: light * H,
      deep_ms: deep * H,
      rem_ms: rem * H,
      start_local: `${shiftDate(d, -1)}T${String(bh).padStart(2, "0")}:${String(bm).padStart(2, "0")}:00`,
    });
    const prevStrain = strainBy.get(shiftDate(d, -1))!;
    const score =
      55 + sleepEffect * (hours - 6.5) + strainEffect * (prevStrain - 10) + (r() - 0.5) * 2 * noise;
    out.recovery.push({ date: d, recovery_score: Math.max(1, Math.min(99, score)) });
  }
  return out;
}

const find = (res: ReturnType<typeof computeRecoveryDrivers>, key: string) => {
  if (res.status !== "ok") throw new Error("expected ok");
  return [...res.top, ...res.others].find((d) => d.key === key)!;
};

describe("isRecoveryDriversEnabled", () => {
  it("is on only for exactly '1'", () => {
    expect(isRecoveryDriversEnabled({ RECOVERY_DRIVERS: "1" })).toBe(true);
    for (const v of [undefined, "", "0", "true", "yes", " 1"]) {
      expect(isRecoveryDriversEnabled({ RECOVERY_DRIVERS: v })).toBe(false);
    }
  });
});

describe("strengthLabel", () => {
  it("bands |r|", () => {
    expect(strengthLabel(0.1)).toBeNull();
    expect(strengthLabel(0.2)).toBe("weak");
    expect(strengthLabel(0.35)).toBe("moderate");
    expect(strengthLabel(0.7)).toBe("strong");
  });
});

describe("computeRecoveryDrivers — minimum data", () => {
  it("empty input → insufficient", () => {
    const res = computeRecoveryDrivers({ recovery: [], sleep: [], cycles: [], workouts: [] });
    expect(res).toEqual({ status: "insufficient", pairedDays: 0, minDays: MIN_PAIRED_DAYS });
  });

  it("one day → insufficient", () => {
    const res = computeRecoveryDrivers(fixture({ days: 1 }));
    expect(res.status).toBe("insufficient");
    expect(res.pairedDays).toBe(1);
  });

  it("20 days → insufficient, 21 → ok", () => {
    expect(computeRecoveryDrivers(fixture({ days: 20 })).status).toBe("insufficient");
    expect(computeRecoveryDrivers(fixture({ days: 21 })).status).toBe("ok");
  });

  it("null recovery scores don't count toward the minimum", () => {
    const f = fixture({ days: 25 });
    for (let i = 0; i < 5; i++) f.recovery[i].recovery_score = null;
    expect(computeRecoveryDrivers(f)).toMatchObject({ status: "insufficient", pairedDays: 20 });
  });
});

describe("computeRecoveryDrivers — findings", () => {
  it("surfaces a strong sleep-duration effect with a plain-language summary", () => {
    const res = computeRecoveryDrivers(fixture({ days: 90, sleepEffect: 8 }));
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    const top = res.top[0];
    expect(top.key).toBe("sleep_duration");
    expect(top.strength).toBe("strong");
    expect(top.effectPoints).toBeGreaterThan(9);
    expect(top.summary).toMatch(/^Nights of \d\.\d h or more average \+\d+ recovery vs \d\.\d h or less$/);
    expect(top.highN).toBeGreaterThanOrEqual(5);
    expect(top.lowN).toBeGreaterThanOrEqual(5);
  });

  it("negative strain association is signed and phrased with a minus", () => {
    const res = computeRecoveryDrivers(fixture({ days: 90, strainEffect: -2.5 }));
    const d = find(res, "prior_strain") as DriverFinding;
    expect(d.status).toBe("finding");
    expect(d.correlation).toBeLessThan(0);
    expect(d.effectPoints).toBeLessThan(0);
    expect(d.summary).toContain("average −");
  });

  it("pure noise rarely yields findings (gate holds)", () => {
    // No driver has any real effect here; across 10 seeds × 6 drivers the
    // gate should let through only the occasional chance association.
    let findings = 0;
    for (let seed = 10; seed < 20; seed++) {
      const res = computeRecoveryDrivers(fixture({ days: 45, seed, noise: 15 }));
      if (res.status !== "ok") throw new Error("expected ok");
      findings += res.top.length;
    }
    expect(findings).toBeLessThanOrEqual(4);
  });

  it("ranks at most 3 findings by |r| and keeps every driver accounted for", () => {
    const res = computeRecoveryDrivers(fixture({ days: 120, sleepEffect: 8, strainEffect: -2 }));
    if (res.status !== "ok") throw new Error("expected ok");
    expect(res.top.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < res.top.length; i++) {
      expect(Math.abs(res.top[i - 1].correlation)).toBeGreaterThanOrEqual(Math.abs(res.top[i].correlation));
    }
    expect(res.top.length + res.others.length).toBe(6);
  });

  it("a tiny effect is not a finding even when correlated", () => {
    // sleepEffect 1 pt/h with near-zero noise: r is high, tercile gap < 3 pts.
    const res = computeRecoveryDrivers(fixture({ days: 90, sleepEffect: 1, noise: 0.01 }));
    expect(find(res, "sleep_duration").status).toBe("no_pattern");
  });
});

describe("computeRecoveryDrivers — gaps, nulls and dates", () => {
  it("missing sleep stages and sleep rows mark the driver insufficient, not a crash", () => {
    const f = fixture({ days: 30, sleepEffect: 8 });
    f.sleep = f.sleep.slice(0, 10).map((s, i) => (i % 2 ? { ...s, deep_ms: null } : s));
    const d = find(computeRecoveryDrivers(f), "sleep_duration");
    expect(d.status).toBe("insufficient");
    expect(d.n).toBe(5);
  });

  it("prior-day strain pairs recovery D with the cycle dated D-1", () => {
    const f = fixture({ days: 40, strainEffect: -3 });
    // Shift cycles one day forward: now same-day pairing would match, prior-day wouldn't.
    const shifted = { ...f, cycles: f.cycles.map((c) => ({ ...c, date: shiftDate(c.date, -1) })) };
    expect(find(computeRecoveryDrivers(f), "prior_strain").status).toBe("finding");
    expect(find(computeRecoveryDrivers(shifted), "prior_strain").status).not.toBe("finding");
  });

  it("pairs across a DST boundary and a month boundary without skipping a day", () => {
    // US spring-forward 2026-03-08; window spans Feb→Mar.
    const f = fixture({ days: 30, end: "2026-03-15", strainEffect: -3 });
    const d = find(computeRecoveryDrivers(f), "prior_strain");
    expect(d.n).toBe(30);
    // and the autumn change, crossing a year boundary too
    const g = fixture({ days: 70, end: "2027-01-05", strainEffect: -3 });
    expect(find(computeRecoveryDrivers(g), "prior_strain").n).toBe(70);
  });

  it("weekend is classified from the date string, independent of host TZ", () => {
    // 2026-11-28 is a Saturday, 2026-11-30 a Monday.
    const f = fixture({ days: 56, end: "2026-11-29", noise: 2 });
    const weekendDates = new Set<string>();
    for (let i = 0; i < 56; i += 7) {
      weekendDates.add(shiftDate("2026-11-28", -i)); // Saturdays
      weekendDates.add(shiftDate("2026-11-29", -i)); // Sundays
    }
    f.recovery = f.recovery.map((r) =>
      weekendDates.has(r.date) ? { ...r, recovery_score: r.recovery_score! + 15 } : r,
    );
    const d = find(computeRecoveryDrivers(f), "weekend") as DriverFinding;
    expect(d.status).toBe("finding");
    expect(d.highN).toBe(16);
    expect(d.lowN).toBe(40);
    expect(d.summary).toMatch(/^Saturday & Sunday mornings average \+1[4-6] recovery vs weekdays$/);
  });

  it("no workouts at all → workout driver insufficient (unknown, not 'all rest days')", () => {
    const f = fixture({ days: 40 });
    f.workouts = [];
    const d = find(computeRecoveryDrivers(f), "workout_day");
    expect(d.status).toBe("insufficient");
    expect(d.n).toBe(0);
  });

  it("bedtimes straddling midnight are measured as close, not ~24 h apart", () => {
    const f = fixture({ days: 30 });
    f.sleep = f.sleep.map((s, i) => ({
      ...s,
      start_local: i % 2 ? `${shiftDate(s.date, -1)}T23:50:00` : `${s.date}T00:10:00`,
    }));
    const d = find(computeRecoveryDrivers(f), "bedtime_regularity");
    // 20 minutes of spread at most → no driver can report a multi-hour gap
    if (d.status === "finding") expect(d.summary).not.toMatch(/\d{3,} min/);
    expect(d.n).toBe(30);
  });

  it("duplicate sleep dates use the first row and don't double-count", () => {
    const f = fixture({ days: 25 });
    f.sleep = [...f.sleep, ...f.sleep];
    expect(find(computeRecoveryDrivers(f), "sleep_duration").n).toBe(25);
  });
});
