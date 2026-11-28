import { describe, expect, it } from "vitest";
import {
  DATA_HEALTH_FETCH_DAYS,
  MAX_WARNINGS,
  buildDataHealth,
  daysBetween,
  formatDuration,
  isIsoDate,
  parseWindow,
  shiftIsoDate,
  summarizeSync,
  windowDates,
  type DataHealthInput,
  type HealthRecoveryRow,
  type HealthSleepRow,
} from "./dataHealth";

const TODAY = "2026-11-27";

function base(over: Partial<DataHealthInput> = {}): DataHealthInput {
  return {
    today: TODAY,
    window: 30,
    recovery: [],
    sleeps: [],
    naps: [],
    cycles: [],
    workouts: [],
    syncLogs: [],
    ...over,
  };
}

function rec(date: string, over: Partial<HealthRecoveryRow> = {}): HealthRecoveryRow {
  return { date, recovery_score: 60, hrv: 70, rhr: 50, spo2: 96, skin_temp: 33.4, ...over };
}

function sleep(date: string, over: Partial<HealthSleepRow> = {}): HealthSleepRow {
  return {
    date,
    in_bed_ms: 8 * 3_600_000,
    respiratory_rate: 15,
    start_local: `${shiftIsoDate(date, -1)}T23:00:00`,
    end_local: `${date}T07:00:00`,
    ...over,
  };
}

/** Every day of the window ending at `end`, optionally skipping some. */
function days(end: string, n: number, skip: string[] = []): string[] {
  return windowDates(end, n).filter((d) => !skip.includes(d));
}

function full(end = TODAY, n = 30, skip: string[] = []): Partial<DataHealthInput> {
  const ds = days(end, n, skip);
  return {
    recovery: ds.map((d) => rec(d)),
    sleeps: ds.map((d) => sleep(d)),
    cycles: ds.map((d) => ({ date: d, strain: 10 })),
  };
}

const metric = (s: ReturnType<typeof buildDataHealth>, key: string) => s.metrics.find((m) => m.key === key)!;

describe("date helpers", () => {
  it("shifts across month/year ends and validates labels", () => {
    expect(shiftIsoDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftIsoDate("2024-03-01", -1)).toBe("2024-02-29");
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-11-27")).toBe(true);
    expect(isIsoDate("2026-11-27T00:00")).toBe(false);
    expect(daysBetween("2026-11-20", "2026-11-27")).toBe(7);
  });

  it("windows across both US DST changes are exactly N distinct consecutive days", () => {
    for (const end of ["2026-03-20", "2026-11-10"]) {
      const w = windowDates(end, 30);
      expect(w).toHaveLength(30);
      expect(new Set(w).size).toBe(30);
      expect(w[29]).toBe(end);
      for (let i = 1; i < w.length; i++) expect(daysBetween(w[i - 1], w[i])).toBe(1);
    }
    // 2026-03-08 (spring forward) and 2026-11-01 (fall back) each appear once.
    expect(windowDates("2026-03-20", 30).filter((d) => d === "2026-03-08")).toHaveLength(1);
    expect(windowDates("2026-11-10", 30).filter((d) => d === "2026-11-01")).toHaveLength(1);
  });

  it("parses the window param, defaulting to 30", () => {
    expect(parseWindow("90")).toBe(90);
    expect(parseWindow(["90", "30"])).toBe(90);
    expect(parseWindow("31")).toBe(30);
    expect(parseWindow(undefined)).toBe(30);
    expect(parseWindow("abc")).toBe(30);
  });

  it("fetches enough history for every requirement lookback", () => {
    expect(DATA_HEALTH_FETCH_DAYS).toBeGreaterThanOrEqual(120);
  });

  it("formats durations", () => {
    expect(formatDuration(7 * 3_600_000 + 5 * 60_000)).toBe("7h 05m");
    expect(formatDuration(45 * 60_000)).toBe("45m");
    expect(formatDuration(null)).toBe("0m");
  });
});

describe("buildDataHealth", () => {
  it("rejects a malformed today", () => {
    expect(() => buildDataHealth(base({ today: "11/27/2026" }))).toThrow(/bad today/);
  });

  it("empty data: everything missing, no warnings, no sync, overall 0%", () => {
    const s = buildDataHealth(base());
    expect(s.dates).toHaveLength(30);
    expect(s.start).toBe("2026-10-29");
    const r = metric(s, "recovery");
    expect(r.present).toBe(0);
    expect(r.expected).toBe(29); // today is pending, not missing
    expect(r.missing).toBe(29);
    expect(r.status).toBe("none");
    expect(r.longestGap).toEqual({ start: "2026-10-29", end: "2026-11-26", days: 29 });
    expect(r.days[29].state).toBe("pending");
    expect(metric(s, "spo2").status).toBe("not-recorded");
    expect(metric(s, "workouts").status).toBe("activity");
    expect(s.overallPct).toBe(0);
    expect(s.latestDataDate).toBeNull();
    expect(s.warnings).toEqual([]);
    expect(s.sync).toEqual([]);
    expect(s.requirements).toEqual([]);
  });

  it("full data: 100% everywhere, no gaps", () => {
    const s = buildDataHealth(base(full()));
    for (const k of ["recovery", "hrv", "rhr", "resp", "skin_temp", "spo2", "sleep", "strain"]) {
      const m = metric(s, k);
      expect(m.pct, k).toBe(100);
      expect(m.status, k).toBe("complete");
      expect(m.longestGap, k).toBeNull();
      expect(m.expected, k).toBe(30);
    }
    expect(s.overallPct).toBe(100);
    expect(s.latestDataDate).toBe(TODAY);
  });

  it("a single day of data", () => {
    const s = buildDataHealth(base({ recovery: [rec("2026-11-20")] }));
    const r = metric(s, "recovery");
    expect(r.present).toBe(1);
    expect(r.lastDate).toBe("2026-11-20");
    expect(r.gapCount).toBe(2);
    expect(r.longestGap).toEqual({ start: "2026-10-29", end: "2026-11-19", days: 22 });
    expect(r.status).toBe("poor");
    expect(s.latestDataDate).toBe("2026-11-20");
  });

  it("finds gaps, ties go to the most recent", () => {
    const skip = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-10"];
    const s = buildDataHealth(base(full(TODAY, 30, skip)));
    const r = metric(s, "recovery");
    expect(r.missing).toBe(7);
    expect(r.gapCount).toBe(3);
    expect(r.longestGap).toEqual({ start: "2026-11-20", end: "2026-11-22", days: 3 });
    expect(r.pct).toBe(77); // 23/30
    expect(r.status).toBe("patchy");
  });

  it("nulls count as missing per column, independently", () => {
    const ds = days(TODAY, 30);
    const s = buildDataHealth(
      base({
        recovery: ds.map((d, i) => rec(d, { hrv: i % 2 ? null : 70, recovery_score: null, spo2: null })),
        sleeps: ds.map((d) => sleep(d, { respiratory_rate: null, in_bed_ms: 0 })),
        cycles: ds.map((d) => ({ date: d, strain: Number.NaN })),
      }),
    );
    expect(metric(s, "recovery").present).toBe(0);
    expect(metric(s, "hrv").present).toBe(15);
    expect(metric(s, "rhr").present).toBe(30);
    expect(metric(s, "spo2").status).toBe("not-recorded");
    expect(metric(s, "resp").present).toBe(0);
    expect(metric(s, "sleep").present).toBe(0); // zero-length sleep is not a night
    expect(metric(s, "strain").present).toBe(0);
  });

  it("today missing is pending; today present counts", () => {
    const s = buildDataHealth(base(full(shiftIsoDate(TODAY, -1), 29)));
    const r = metric(s, "recovery");
    expect(r.pct).toBe(100);
    expect(r.days.at(-1)!.state).toBe("pending");
    expect(r.longestGap).toBeNull();
  });

  it("ignores rows outside the window and in the future", () => {
    const s = buildDataHealth(
      base({ recovery: [rec("2026-01-01"), rec("2026-12-25")], sleeps: [sleep("2026-12-01")] }),
    );
    expect(metric(s, "recovery").present).toBe(0);
    expect(s.latestDataDate).toBe("2026-01-01");
  });

  it("90-day window", () => {
    const s = buildDataHealth(base({ ...full(TODAY, 120), window: 90 }));
    expect(s.dates).toHaveLength(90);
    expect(s.start).toBe("2026-08-30");
    expect(metric(s, "recovery").present).toBe(90);
  });

  it("workouts are activity days, never 'missing'", () => {
    const s = buildDataHealth(base({ workouts: [{ date: "2026-11-25" }, { date: "2026-11-25" }, { date: "2026-11-26" }] }));
    const w = metric(s, "workouts");
    expect(w.present).toBe(2);
    expect(w.missing).toBe(0);
    expect(w.days.filter((d) => d.state === "idle")).toHaveLength(28);
  });

  it("a partially-recorded optional sensor is treated as daily", () => {
    const ds = days(TODAY, 30);
    const s = buildDataHealth(base({ recovery: ds.map((d, i) => rec(d, { spo2: i < 10 ? null : 95 })) }));
    expect(metric(s, "spo2").status).toBe("patchy");
    expect(metric(s, "spo2").missing).toBe(10);
  });

  it("DST: a window spanning fall-back still has one cell per local day", () => {
    const end = "2026-11-10";
    const s = buildDataHealth(base({ today: end, ...full(end, 30) }));
    expect(metric(s, "sleep").present).toBe(30);
    expect(metric(s, "sleep").days.map((d) => d.date)).toContain("2026-11-01");
  });
});

describe("duplicate and overlap warnings", () => {
  it("flags two main sleeps on one date, keeping the longest like the charts", () => {
    const s = buildDataHealth(
      base({
        sleeps: [
          sleep("2026-11-20", { in_bed_ms: 3 * 3_600_000, start_local: "2026-11-20T00:00:00", end_local: "2026-11-20T03:00:00" }),
          sleep("2026-11-20", { in_bed_ms: 5 * 3_600_000, start_local: "2026-11-20T04:00:00", end_local: "2026-11-20T09:00:00" }),
        ],
      }),
    );
    expect(s.warnings).toHaveLength(1);
    expect(s.warnings[0]).toMatchObject({ kind: "duplicate-sleep", date: "2026-11-20" });
    expect(s.warnings[0].detail).toContain("longest (5h 00m)");
    expect(s.warnings[0].detail).toContain("(3h 00m)");
    // Duplicates still count the day once.
    expect(metric(s, "sleep").present).toBe(1);
  });

  it("flags a nap inside the main sleep and overlapping main sleeps", () => {
    const s = buildDataHealth(
      base({
        sleeps: [
          sleep("2026-11-21"), // 11-20 23:00 → 11-21 07:00
          sleep("2026-11-24", { start_local: "2026-11-23T22:00:00", end_local: "2026-11-24T06:00:00" }),
          sleep("2026-11-24", { in_bed_ms: 3_600_000, start_local: "2026-11-24T05:30:00", end_local: "2026-11-24T06:30:00" }),
        ],
        naps: [
          { date: "2026-11-21", duration_ms: 3_600_000, start_local: "2026-11-21T06:00:00", end_local: "2026-11-21T07:30:00" },
          // Not overlapping: afternoon nap.
          { date: "2026-11-22", duration_ms: 1_800_000, start_local: "2026-11-22T14:00:00", end_local: "2026-11-22T14:30:00" },
        ],
      }),
    );
    const kinds = s.warnings.map((w) => `${w.date}:${w.kind}:${w.title}`);
    expect(kinds).toEqual([
      "2026-11-24:duplicate-sleep:2 main sleeps on one day",
      "2026-11-24:overlap:Two sleeps overlap",
      "2026-11-21:overlap:Nap overlaps main sleep",
    ]);
    expect(s.warnings[2].detail).toContain("share 1h 00m");
    expect(s.warnings[1].detail).toContain("30m");
  });

  it("ignores touching intervals, bad timestamps and rows outside the window", () => {
    const s = buildDataHealth(
      base({
        sleeps: [
          sleep("2026-11-21"),
          sleep("2026-01-05"),
          sleep("2026-01-05"),
          sleep("2026-11-22", { start_local: null }),
        ],
        naps: [
          { date: "2026-11-21", duration_ms: 1, start_local: "2026-11-21T07:00:00", end_local: "2026-11-21T08:00:00" },
          { date: "2026-11-22", duration_ms: 1, start_local: "garbage", end_local: "2026-11-22T08:00:00" },
        ],
      }),
    );
    expect(s.warnings).toEqual([]);
  });

  it("caps the list but reports the total", () => {
    const sleeps = days(TODAY, 30).flatMap((d) => [sleep(d), sleep(d, { in_bed_ms: 1000, start_local: null })]);
    const s = buildDataHealth(base({ sleeps }));
    expect(s.warningTotal).toBe(30);
    expect(s.warnings).toHaveLength(MAX_WARNINGS);
    expect(s.warnings[0].date).toBe(TODAY); // newest first
  });
});

describe("sync summary", () => {
  it("latest ok/error per source, newest source first, keepalive ignored", () => {
    const out = summarizeSync([
      { started_at: "2026-11-27T12:00:00Z", status: "ok", source: "webhook", error_message: null },
      { started_at: "2026-11-27T13:00:00Z", status: "error", source: "manual", error_message: "Whoop 401" },
      { started_at: "2026-11-26T08:00:00Z", status: "ok", source: "manual", error_message: null },
      { started_at: "2026-11-27T14:00:00Z", status: "ok", source: "keepalive", error_message: null },
      { started_at: "2026-11-20T08:00:00Z", status: "ok", source: null, error_message: null },
      { started_at: "not a date", status: "ok", source: "coach", error_message: null },
    ]);
    expect(out).toEqual([
      {
        source: "manual",
        label: "Manual sync",
        lastOkAt: "2026-11-26T08:00:00.000Z",
        lastErrorAt: "2026-11-27T13:00:00.000Z",
        failing: "Whoop 401",
      },
      {
        source: "webhook",
        label: "Real-time updates",
        lastOkAt: "2026-11-27T12:00:00.000Z",
        lastErrorAt: null,
        failing: null,
      },
    ]);
  });

  it("an error followed by success is not failing; long messages are truncated", () => {
    const out = summarizeSync([
      { started_at: "2026-11-27T10:00:00Z", status: "error", source: "coach", error_message: "x".repeat(500) },
      { started_at: "2026-11-27T11:00:00Z", status: "ok", source: "coach", error_message: null },
      { started_at: "2026-11-27T09:00:00Z", status: "error", source: "onboarding", error_message: "y".repeat(500) },
    ]);
    expect(out[0]).toMatchObject({ source: "coach", failing: null, lastErrorAt: "2026-11-27T10:00:00.000Z" });
    expect(out[1].failing!.length).toBe(140);
    expect(out[1].label).toBe("First sync");
  });
});

describe("requirements", () => {
  const all = { trainingLoad: true, sleepPlan: true, recoveryDrivers: true, weeklyReview: true };

  it("lists only enabled features", () => {
    expect(buildDataHealth(base(full())).requirements).toEqual([]);
    const s = buildDataHealth(base({ ...full(), features: { sleepPlan: true } }));
    expect(s.requirements.map((r) => r.key)).toEqual(["sleep-plan"]);
  });

  it("met with full history", () => {
    const s = buildDataHealth(base({ ...full(TODAY, 120), features: all }));
    expect(s.requirements.map((r) => [r.key, r.met, r.have])).toEqual([
      ["training-load", true, 28],
      ["sleep-plan", true, 30],
      ["recovery-drivers", true, 120],
      ["weekly-review", true, 7],
    ]);
  });

  it("unmet with sparse history explains what is needed", () => {
    const s = buildDataHealth(base({ ...full(TODAY, 3), features: all }));
    const byKey = Object.fromEntries(s.requirements.map((r) => [r.key, r]));
    expect(byKey["training-load"]).toMatchObject({ met: false, have: 3, need: 14 });
    expect(byKey["training-load"].explanation).toContain("building baseline");
    expect(byKey["sleep-plan"]).toMatchObject({ met: false, have: 3, need: 5 });
    expect(byKey["recovery-drivers"]).toMatchObject({ met: false, have: 3, need: 21 });
    expect(byKey["weekly-review"]).toMatchObject({ met: false, have: 3, need: 4 });
  });

  it("training load also needs the acute window", () => {
    // 20 strain days, but none in the last 7.
    const end = shiftIsoDate(TODAY, -7);
    const s = buildDataHealth(base({ cycles: days(end, 20).map((d) => ({ date: d, strain: 9 })), features: all }));
    const tl = s.requirements.find((r) => r.key === "training-load")!;
    expect(tl.have).toBe(20);
    expect(tl.met).toBe(false);
  });

  it("requirements use the requirement lookback, not the selected window", () => {
    const s = buildDataHealth(base({ ...full(TODAY, 120), window: 30, features: { recoveryDrivers: true } }));
    expect(s.requirements[0].have).toBe(120);
  });
});

describe("pure", () => {
  it("does not mutate inputs and is deterministic", () => {
    const input = base({ ...full(TODAY, 30, ["2026-11-10"]), features: { trainingLoad: true } });
    const snapshot = JSON.stringify(input);
    const a = buildDataHealth(input);
    const b = buildDataHealth(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(a).toEqual(b);
  });
});
