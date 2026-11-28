import { describe, expect, it } from "vitest";
import {
  BASELINE_METRICS,
  MIN_BASELINE_DAYS,
  bandPosition,
  baselineReadStart,
  computeBaselines,
  formatMetricValue,
  parseBaselineWindow,
  type BaselineInputs,
  type BaselineMetricKey,
} from "./baselines";
import { percentile } from "./recoveryOutlook";

const H = 3_600_000;
const TODAY = "2026-11-27";

function dates(end: string, n: number): string[] {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) =>
    new Date(endMs - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

type Rec = BaselineInputs["recovery"][number];
const rec = (date: string, o: Partial<Rec> = {}): Rec => ({
  date,
  recovery_score: 60,
  hrv: 50,
  rhr: 55,
  skin_temp: 33.5,
  ...o,
});

type Slp = BaselineInputs["sleep"][number];
const slp = (date: string, o: Partial<Slp> = {}): Slp => ({
  date,
  light_ms: 4 * H,
  deep_ms: 1.5 * H,
  rem_ms: 1.5 * H,
  performance: 85,
  respiratory_rate: 15,
  ...o,
});

const empty: BaselineInputs = { recovery: [], sleep: [], cycles: [] };

function metric(r: ReturnType<typeof computeBaselines>, key: BaselineMetricKey) {
  return r.metrics.find((m) => m.key === key)!;
}

describe("parseBaselineWindow / baselineReadStart", () => {
  it("accepts 30/60/90 and falls back to 30", () => {
    expect(parseBaselineWindow("60")).toBe(60);
    expect(parseBaselineWindow("90")).toBe(90);
    for (const v of [undefined, "", "45", "abc", "30.5", "-30"]) expect(parseBaselineWindow(v)).toBe(30);
  });

  it("reads back far enough for the 60-day trend window plus the strain shift", () => {
    expect(baselineReadStart(TODAY, 30)).toBe("2026-08-29");
    expect(baselineReadStart(TODAY, 90)).toBe("2026-06-30");
  });
});

describe("computeBaselines: sparse data", () => {
  it("empty data: every metric is building, nothing else computed", () => {
    const r = computeBaselines(empty, TODAY, 30);
    expect(r.anyReady).toBe(false);
    expect(r.metrics.map((m) => m.key)).toEqual(BASELINE_METRICS.map((d) => d.key));
    for (const m of r.metrics) {
      expect(m.status).toBe("building");
      expect(m.days).toBe(0);
      expect(m.baseline).toBeNull();
      expect(m.latest).toBeNull();
      expect(m.trend).toBeNull();
      expect(m.summary).toContain(`0 of ${MIN_BASELINE_DAYS} days`);
    }
  });

  it("1 day: building with a count and singular wording at 13", () => {
    const one = computeBaselines({ ...empty, recovery: [rec(TODAY)] }, TODAY, 30);
    expect(metric(one, "hrv").days).toBe(1);
    expect(metric(one, "hrv").summary).toContain("13 more days");
    const r13 = computeBaselines({ ...empty, recovery: dates(TODAY, 13).map((d) => rec(d)) }, TODAY, 30);
    expect(metric(r13, "hrv").status).toBe("building");
    expect(metric(r13, "hrv").summary).toContain("1 more day of data");
  });

  it("exactly MIN_BASELINE_DAYS values is ready", () => {
    const r = computeBaselines({ ...empty, recovery: dates(TODAY, 14).map((d) => rec(d)) }, TODAY, 30);
    expect(metric(r, "hrv").status).toBe("ready");
    expect(metric(r, "hrv").baseline).toBe(50);
    expect(r.anyReady).toBe(true);
  });

  it("gaps: only days with values count, scattered over the window", () => {
    const every3rd = dates(TODAY, 30).filter((_, i) => i % 3 === 0).map((d) => rec(d));
    const r = computeBaselines({ ...empty, recovery: every3rd }, TODAY, 30);
    expect(metric(r, "hrv").days).toBe(10);
    expect(metric(r, "hrv").status).toBe("building");
  });
});

describe("computeBaselines: values", () => {
  it("nulls, NaN and Infinity are skipped per metric, not per row", () => {
    const rows = dates(TODAY, 20).map((d, i) =>
      rec(d, { hrv: i < 10 ? null : i === 10 ? Number.NaN : i === 11 ? Infinity : 40 + i, rhr: 50 }),
    );
    const r = computeBaselines({ ...empty, recovery: rows }, TODAY, 30);
    expect(metric(r, "hrv").days).toBe(8);
    expect(metric(r, "hrv").status).toBe("building");
    expect(metric(r, "rhr").days).toBe(20);
    expect(metric(r, "rhr").status).toBe("ready");
  });

  it("baseline is the median and the band the 25th–75th percentile (linear)", () => {
    const vals = Array.from({ length: 20 }, (_, i) => 30 + i); // 30..49
    const r = computeBaselines(
      { ...empty, recovery: dates(TODAY, 20).map((d, i) => rec(d, { hrv: vals[i] })) },
      TODAY,
      30,
    );
    const m = metric(r, "hrv");
    expect(m.baseline).toBe(39.5);
    expect(m.bandLow).toBeCloseTo(34.75, 10);
    expect(m.bandHigh).toBeCloseTo(44.25, 10);
    expect(m.bandLow).toBe(percentile([...vals], 0.25));
    // Today = 49 → above the band.
    expect(m.latest).toMatchObject({ date: TODAY, value: 49, position: "above" });
    expect(m.latest!.delta).toBeCloseTo(9.5, 10);
  });

  it("ties: an all-equal series has a zero-width band and the value is within", () => {
    const r = computeBaselines({ ...empty, recovery: dates(TODAY, 20).map((d) => rec(d, { rhr: 52 })) }, TODAY, 30);
    const m = metric(r, "rhr");
    expect([m.baseline, m.bandLow, m.bandHigh]).toEqual([52, 52, 52]);
    expect(m.latest!.position).toBe("within");
    expect(m.summary).toContain("Within your normal range");
  });

  it("band edges count as within", () => {
    expect(bandPosition(10, 10, 20)).toBe("within");
    expect(bandPosition(20, 10, 20)).toBe("within");
    expect(bandPosition(9.999, 10, 20)).toBe("below");
    expect(bandPosition(20.001, 10, 20)).toBe("above");
  });

  it("outliers: one extreme day barely moves the baseline", () => {
    const base = dates(TODAY, 21).map((d) => rec(d, { hrv: 50 }));
    base[5] = rec(base[5].date, { hrv: 500 });
    base[20] = rec(TODAY, { hrv: 20 });
    const m = metric(computeBaselines({ ...empty, recovery: base }, TODAY, 30), "hrv");
    expect(m.baseline).toBe(50);
    expect(m.latest!.position).toBe("below");
    expect(m.summary).toMatch(/^Lower than usual/);
  });

  it("repeated dates keep the last row; malformed dates are dropped", () => {
    const rows = [...dates(TODAY, 14).map((d) => rec(d, { hrv: 50 })), rec(TODAY, { hrv: 80 }), rec("2026-13-99x", { hrv: 1 }), rec("", { hrv: 1 })];
    const m = metric(computeBaselines({ ...empty, recovery: rows }, TODAY, 30), "hrv");
    expect(m.days).toBe(14);
    expect(m.latest!.value).toBe(80);
  });

  it("rows outside the window and future rows are ignored for the baseline", () => {
    const rows = [
      ...dates("2026-09-01", 30).map((d) => rec(d, { hrv: 999 })),
      ...dates(TODAY, 14).map((d) => rec(d, { hrv: 50 })),
      rec("2026-11-28", { hrv: 999 }),
    ];
    const m = metric(computeBaselines({ ...empty, recovery: rows }, TODAY, 30), "hrv");
    expect(m.days).toBe(14);
    expect(m.baseline).toBe(50);
    expect(m.series.at(-1)!.date).toBe(TODAY);
  });

  it("the window selection changes the sample", () => {
    const rows = dates(TODAY, 90).map((d, i) => rec(d, { hrv: i < 60 ? 40 : 60 }));
    expect(metric(computeBaselines({ ...empty, recovery: rows }, TODAY, 30), "hrv").baseline).toBe(60);
    expect(metric(computeBaselines({ ...empty, recovery: rows }, TODAY, 90), "hrv").baseline).toBe(40);
    expect(metric(computeBaselines({ ...empty, recovery: rows }, TODAY, 60), "hrv").days).toBe(60);
  });

  it("a stale latest value (older than 3 days) is not shown as today", () => {
    const rows = dates("2026-11-23", 20).map((d) => rec(d));
    const m = metric(computeBaselines({ ...empty, recovery: rows }, TODAY, 30), "hrv");
    expect(m.status).toBe("ready");
    expect(m.latest).toBeNull();
    expect(m.summary).toContain("No recent reading");
    const fresh = metric(computeBaselines({ ...empty, recovery: dates("2026-11-25", 20).map((d) => rec(d)) }, TODAY, 30), "hrv");
    expect(fresh.latest!.date).toBe("2026-11-25");
  });

  it("sleep duration is light+deep+REM hours; a missing stage drops that night", () => {
    const rows = dates(TODAY, 15).map((d, i) => slp(d, i === 0 ? { deep_ms: null } : {}));
    const m = metric(computeBaselines({ ...empty, sleep: rows }, TODAY, 30), "sleep_hours");
    expect(m.days).toBe(14);
    expect(m.baseline).toBe(7);
    expect(metric(computeBaselines({ ...empty, sleep: rows }, TODAY, 30), "respiratory_rate").days).toBe(15);
  });

  it("strain ends yesterday: today's in-progress cycle is excluded", () => {
    const cycles = [...dates("2026-11-26", 20).map((d) => ({ date: d, strain: 12 })), { date: TODAY, strain: 2 }];
    const m = metric(computeBaselines({ ...empty, cycles }, TODAY, 30), "strain");
    expect(m.days).toBe(20);
    expect(m.latest).toMatchObject({ date: "2026-11-26", value: 12, position: "within" });
  });

  it("skin temperature carries the deviation from baseline", () => {
    const rows = dates(TODAY, 20).map((d) => rec(d, { skin_temp: d === TODAY ? 34.1 : 33.5 }));
    const m = metric(computeBaselines({ ...empty, recovery: rows }, TODAY, 30), "skin_temp");
    expect(m.showAsDeviation).toBe(true);
    expect(m.latest!.delta).toBeCloseTo(0.6, 10);
    expect(m.latest!.position).toBe("above");
  });
});

describe("computeBaselines: baseline trend", () => {
  const span = dates(TODAY, 90);

  it("rising HRV over 60 days reads as better", () => {
    const rows = span.map((d, i) => rec(d, { hrv: i < 60 ? 45 : 55 }));
    const m = metric(computeBaselines({ ...empty, recovery: rows }, TODAY, 30), "hrv");
    expect(m.trend).toMatchObject({ previous: 45, change: 10, direction: "rising", meaning: "better" });
    expect(m.summary).toContain("up 10 ms vs 60 days ago");
  });

  it("rising resting HR reads as worse", () => {
    const rows = span.map((d, i) => rec(d, { rhr: i < 60 ? 50 : 56 }));
    const m = metric(computeBaselines({ ...empty, recovery: rows }, TODAY, 30), "rhr");
    expect(m.trend).toMatchObject({ direction: "rising", meaning: "worse" });
  });

  it("a change under the steady threshold is steady", () => {
    const rows = span.map((d, i) => rec(d, { hrv: (i % 10) + 45 + (i >= 60 ? 0.5 : 0) }));
    const m = metric(computeBaselines({ ...empty, recovery: rows }, TODAY, 30), "hrv");
    expect(m.trend!.direction).toBe("steady");
    expect(m.trend!.meaning).toBe("neutral");
    expect(m.summary).toContain("about the same as 60 days ago");
  });

  it("neutral metrics never claim better or worse", () => {
    const rows = dates(TODAY, 90).map((d, i) => slp(d, { respiratory_rate: i < 60 ? 14 : 16 }));
    const m = metric(computeBaselines({ ...empty, sleep: rows }, TODAY, 30), "respiratory_rate");
    expect(m.trend).toMatchObject({ direction: "rising", meaning: "neutral" });
  });

  it("no trend without enough history 60 days ago", () => {
    const rows = dates(TODAY, 30).map((d) => rec(d));
    const m = metric(computeBaselines({ ...empty, recovery: rows }, TODAY, 30), "hrv");
    expect(m.trend).toBeNull();
    expect(m.summary).toContain("Not enough history");
  });
});

describe("computeBaselines: dates", () => {
  it("a window spanning the US DST change (Nov 1 2026) has exactly N calendar days", () => {
    const rows = dates("2026-11-10", 30).map((d) => rec(d));
    const r = computeBaselines({ ...empty, recovery: rows }, "2026-11-10", 30);
    expect(r.start).toBe("2026-10-12");
    expect(metric(r, "hrv").days).toBe(30);
  });

  it("spring-forward window (Mar 8 2026) and a leap-free February", () => {
    const rows = dates("2026-03-20", 30).map((d) => rec(d));
    const r = computeBaselines({ ...empty, recovery: rows }, "2026-03-20", 30);
    expect(r.start).toBe("2026-02-19");
    expect(metric(r, "hrv").days).toBe(30);
  });

  it("year boundary", () => {
    const rows = dates("2027-01-05", 20).map((d) => rec(d));
    const m = metric(computeBaselines({ ...empty, recovery: rows }, "2027-01-05", 30), "hrv");
    expect(m.days).toBe(20);
    expect(m.series[0].date).toBe("2026-12-17");
  });
});

describe("formatMetricValue", () => {
  it("rounds, signs and never prints -0", () => {
    expect(formatMetricValue(49.6, 0)).toBe("50");
    expect(formatMetricValue(0.04, 1, true)).toBe("±0.0");
    expect(formatMetricValue(-0.04, 1, true)).toBe("±0.0");
    expect(formatMetricValue(0.6, 1, true)).toBe("+0.6");
    expect(formatMetricValue(-2, 0, true)).toBe("−2");
    expect(formatMetricValue(-2, 0)).toBe("−2");
  });
});

describe("metric windows", () => {
  it("every metric spans the window; strain's ends yesterday", () => {
    const r = computeBaselines(empty, TODAY, 60);
    for (const m of r.metrics) {
      if (m.key === "strain") expect([m.start, m.end]).toEqual(["2026-09-28", "2026-11-26"]);
      else expect([m.start, m.end]).toEqual(["2026-09-29", TODAY]);
    }
  });
});
