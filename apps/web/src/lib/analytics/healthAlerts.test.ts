import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  alertBadgeCount,
  computeHealthAlerts,
  daysBetween,
  trailingStreak,
  type HealthAlertsInput,
} from "./healthAlerts";
import { shiftDate } from "@/lib/range";
import type { CycleRow, RecoveryRow, SleepRow } from "@/lib/db";

const TODAY = "2026-11-27";
const NOW = Date.UTC(2026, 10, 27, 14, 0, 0);

type Day = Partial<RecoveryRow> & { respiratory_rate?: number | null; debt_min?: number | null; strain?: number | null };

function sleepRow(date: string, rr: number | null, debtMin: number | null): SleepRow {
  return {
    date,
    in_bed_ms: 8 * 3_600_000,
    light_ms: 4 * 3_600_000,
    deep_ms: 3_600_000,
    rem_ms: 2 * 3_600_000,
    awake_ms: 1_800_000,
    sleep_need_ms: 8 * 3_600_000,
    performance: 90,
    efficiency: 92,
    consistency: 80,
    disturbances: 5,
    cycles: 4,
    respiratory_rate: rr,
    need_from_baseline_ms: 7.5 * 3_600_000,
    need_from_debt_ms: debtMin == null ? null : debtMin * 60_000,
    need_from_strain_ms: 0,
    need_from_nap_ms: 0,
    start_local: null,
    end_local: null,
  };
}

/** Build `n` days ending at `end`, steady baseline with small deterministic wobble; `over` patches specific offsets from the end (0 = end). */
function build(
  n: number,
  over: Record<number, Day> = {},
  end = TODAY,
): Pick<HealthAlertsInput, "recovery" | "sleep" | "cycles"> {
  const recovery: RecoveryRow[] = [];
  const sleep: SleepRow[] = [];
  const cycles: CycleRow[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = shiftDate(end, -i);
    const w = ((n - i) % 3) - 1; // -1, 0, 1 repeating
    const o = over[i] ?? {};
    recovery.push({
      date,
      recovery_score: o.recovery_score !== undefined ? o.recovery_score : 65 + w * 4,
      hrv: o.hrv !== undefined ? o.hrv : 60 + w * 3,
      rhr: o.rhr !== undefined ? o.rhr : 52 + w * 0.5,
      spo2: 96,
      skin_temp: o.skin_temp !== undefined ? o.skin_temp : 33.5 + w * 0.1,
    });
    sleep.push(
      sleepRow(
        date,
        o.respiratory_rate !== undefined ? o.respiratory_rate : 15 + w * 0.2,
        o.debt_min !== undefined ? o.debt_min : 10,
      ),
    );
    // Base strain eases off slowly (slope −0.2/day), which keeps computeOTS's
    // strain gate closed so tests about other signals stay isolated from it.
    cycles.push({ date, strain: o.strain !== undefined ? o.strain : 16 - (n - i) * 0.2 } as CycleRow);
  }
  return { recovery, sleep, cycles };
}

function run(data: Pick<HealthAlertsInput, "recovery" | "sleep" | "cycles">, extra: Partial<HealthAlertsInput> = {}) {
  return computeHealthAlerts({
    today: TODAY,
    nowMs: NOW,
    lastSyncAt: new Date(NOW - 2 * 3_600_000),
    ...data,
    ...extra,
  });
}

const kinds = (r: ReturnType<typeof run>) => r.alerts.map((a) => a.kind);
const check = (r: ReturnType<typeof run>, k: string) => r.checks.find((c) => c.kind === k)?.status;

describe("date helpers", () => {
  it("counts calendar days across the US DST transitions", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2); // spring forward Mar 8
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2); // fall back Nov 1
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2); // leap year
  });

  it("trailingStreak stops at a calendar gap or a failing row", () => {
    const rows = ["2026-11-20", "2026-11-22", "2026-11-23", "2026-11-24"].map((date) => ({ date, ok: true }));
    expect(trailingStreak(rows, (r) => r.ok)).toEqual({ since: "2026-11-22", days: 3 });
    rows[3].ok = false;
    expect(trailingStreak(rows, (r) => r.ok)).toBeNull();
    expect(trailingStreak([], () => true)).toBeNull();
  });
});

describe("computeHealthAlerts", () => {
  it("empty data: one calm info alert, every metric check insufficient", () => {
    const r = run({ recovery: [], sleep: [], cycles: [] }, { lastSyncAt: null });
    expect(r.asOf).toBeNull();
    expect(r.alerts).toHaveLength(1);
    expect(r.alerts[0]).toMatchObject({ kind: "freshness", severity: "info", title: "No Whoop data yet" });
    expect(r.alerts[0].detail).toContain("No successful sync is on record");
    expect(r.checks.filter((c) => c.kind !== "freshness").every((c) => c.status === "insufficient")).toBe(true);
    expect(alertBadgeCount(r)).toBe(0);
  });

  it("a single day of data flags nothing and reports insufficient history", () => {
    const r = run(build(1));
    expect(r.alerts).toEqual([]);
    expect(r.asOf).toBe(TODAY);
    expect(check(r, "freshness")).toBe("clear");
    for (const k of ["illness", "overtraining", "hrv_low", "rhr_high", "skin_temp", "resp_rate"]) {
      expect(check(r, k)).toBe("insufficient");
    }
    // Whoop's own debt number needs no history.
    expect(check(r, "sleep_debt")).toBe("clear");
  });

  it("steady 45-day baseline: nothing to flag", () => {
    const r = run(build(45));
    expect(r.alerts).toEqual([]);
    expect(r.checks.every((c) => c.status === "clear")).toBe(true);
  });

  it("all-null metrics never throw and stay insufficient", () => {
    const d = build(30);
    for (const row of d.recovery) Object.assign(row, { hrv: null, rhr: null, skin_temp: null, recovery_score: null });
    for (const row of d.sleep) Object.assign(row, { respiratory_rate: null, need_from_debt_ms: null });
    const r = run(d);
    expect(r.alerts).toEqual([]);
    expect(r.checks.filter((c) => c.kind !== "freshness" && c.kind !== "overtraining").every((c) => c.status === "insufficient")).toBe(true);
  });

  it("stale data: watch at 2 days, act at 4+, and suppresses metric checks past 3 days", () => {
    const two = run(build(40, {}, shiftDate(TODAY, -2)));
    expect(two.alerts[0]).toMatchObject({ kind: "freshness", severity: "watch", title: "Data is 2 days old", since: "2026-11-25" });
    expect(check(two, "illness")).toBe("clear");

    const five = run(build(40, { 0: { hrv: 20, rhr: 70, skin_temp: 35 } }, shiftDate(TODAY, -5)), {
      lastSyncAt: new Date(NOW - 130 * 3_600_000),
    });
    expect(kinds(five)).toEqual(["freshness"]);
    expect(five.alerts[0].severity).toBe("act");
    expect(five.alerts[0].detail).toContain("130 hours ago");
    expect(check(five, "illness")).toBe("insufficient");
  });

  it("illness: >=2 signals is one act alert that absorbs the per-metric alerts", () => {
    const sick = { hrv: 45, rhr: 58, skin_temp: 34.4 };
    const r = run(build(40, { 0: sick, 1: sick }));
    expect(r.alerts[0]).toMatchObject({ kind: "illness", severity: "act", since: "2026-11-26", days: 2 });
    expect(r.alerts[0].detail).toMatch(/3 of 3 signals.*resting HR \+\d/);
    expect(kinds(r)).not.toContain("rhr_high");
    expect(kinds(r)).not.toContain("skin_temp");
    expect(check(r, "rhr_high")).toBe("covered");
    expect(check(r, "skin_temp")).toBe("covered");
    expect(alertBadgeCount(r)).toBeGreaterThanOrEqual(1);
  });

  it("RHR alone: 2 days is info, 3 days is watch, with baseline numbers", () => {
    const two = run(build(40, { 0: { rhr: 57 }, 1: { rhr: 57 } }));
    const a2 = two.alerts.find((a) => a.kind === "rhr_high")!;
    expect(a2.severity).toBe("info");
    expect(a2.detail).toMatch(/Resting HR 57 bpm vs your 14-day baseline of 5\d\.\d/);
    expect(alertBadgeCount(two)).toBe(0);

    const three = run(build(40, { 0: { rhr: 57 }, 1: { rhr: 57 }, 2: { rhr: 57 } }));
    expect(three.alerts.find((a) => a.kind === "rhr_high")).toMatchObject({ severity: "watch", days: 3, since: "2026-11-25" });
  });

  it("a missing day breaks the RHR streak", () => {
    const d = build(40, { 0: { rhr: 57 }, 2: { rhr: 57 }, 3: { rhr: 57 } });
    d.recovery = d.recovery.filter((r) => r.date !== shiftDate(TODAY, -1));
    const r = run(d);
    expect(r.alerts.find((a) => a.kind === "rhr_high")).toBeUndefined();
    expect(check(r, "rhr_high")).toBe("clear");
  });

  it("HRV below the 30-day 1.5σ band for 3 days is a watch alert", () => {
    const r = run(build(45, { 0: { hrv: 48 }, 1: { hrv: 49 }, 2: { hrv: 48 } }));
    const a = r.alerts.find((x) => x.kind === "hrv_low")!;
    expect(a).toMatchObject({ severity: "watch", days: 3, since: "2026-11-25" });
    expect(a.detail).toMatch(/HRV 48 ms is \d+% under your 30-day baseline of \d+ ms/);
  });

  it("skin temp: needs a 2-day run ending on the latest reading", () => {
    const r = run(build(30, { 0: { skin_temp: 34.3 }, 1: { skin_temp: 34.3 } }));
    expect(r.alerts.find((a) => a.kind === "skin_temp")).toMatchObject({ severity: "watch", days: 2 });

    const past = run(build(30, { 3: { skin_temp: 34.3 }, 4: { skin_temp: 34.3 } }));
    expect(past.alerts.find((a) => a.kind === "skin_temp")).toBeUndefined();

    const one = run(build(30, { 0: { skin_temp: 34.3 } }));
    expect(one.alerts.find((a) => a.kind === "skin_temp")).toBeUndefined();
  });

  it("respiratory rate outside ±2 br/min: single night info, low side too", () => {
    const hi = run(build(30, { 0: { respiratory_rate: 18 } }));
    expect(hi.alerts.find((a) => a.kind === "resp_rate")).toMatchObject({ severity: "info", title: "Respiratory rate above baseline" });
    const lo = run(build(30, { 0: { respiratory_rate: 12 }, 1: { respiratory_rate: 12 } }));
    expect(lo.alerts.find((a) => a.kind === "resp_rate")).toMatchObject({ severity: "watch", title: "Respiratory rate below baseline" });
  });

  it("sleep debt thresholds 45/90/150 min and night streak", () => {
    const at = (m: number) => run(build(20, { 0: { debt_min: m }, 1: { debt_min: 50 } })).alerts.find((a) => a.kind === "sleep_debt");
    expect(at(30)).toBeUndefined();
    expect(at(60)).toMatchObject({ severity: "info", title: "Sleep debt 1 h", days: 2 });
    expect(at(95)).toMatchObject({ severity: "watch", title: "Sleep debt 1 h 35 min" });
    expect(at(160)?.severity).toBe("act");
  });

  it("overtraining score 3 is an act alert", () => {
    const over: Record<number, Day> = {};
    for (let i = 0; i < 7; i++) {
      over[i] = { hrv: 50 + i, rhr: 56 - i * 0.3, recovery_score: 40 + i * 3, strain: 15 };
    }
    // Keep each day individually inside the RHR/HRV baselines' alert gates.
    const r = run(build(40, over));
    const a = r.alerts.find((x) => x.kind === "overtraining")!;
    expect(a).toMatchObject({ severity: "act", title: "Overtraining score 3/3", days: 7 });
  });

  it("sorts by severity, then by kind; future-dated rows (tz skew) are ignored", () => {
    const d = build(40, { 0: { rhr: 57, debt_min: 160 }, 1: { rhr: 57 } });
    d.recovery.push({ ...d.recovery[d.recovery.length - 1], date: shiftDate(TODAY, 1), rhr: 90 });
    const r = run(d);
    expect(r.asOf).toBe(TODAY);
    expect(r.alerts.map((a) => a.severity)).toEqual([...r.alerts.map((a) => a.severity)].sort((x, y) => "awi".indexOf(x[0]) - "awi".indexOf(y[0])));
    expect(r.alerts[0].kind).toBe("sleep_debt");
  });
});
