import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BIG_DROP_POINTS,
  HIGH_STRAIN,
  buildChartMarkers,
  dayDiff,
  formatMarkerDate,
  placeMarkers,
  type MarkerInputs,
} from "./chartMarkers";

function inputs(over: Partial<MarkerInputs> = {}): MarkerInputs {
  return { start: "2026-10-01", end: "2026-10-31", recovery: [], cycles: [], workouts: [], journal: [], ...over };
}

function days(start: string, n: number): string[] {
  const [y, m, d] = start.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
}

describe("buildChartMarkers", () => {
  it("empty data: no markers", () => {
    expect(buildChartMarkers(inputs())).toEqual([]);
  });

  it("invalid or inverted window: no markers", () => {
    const w = [{ date: "2026-10-05", sport: "running", strain: 9 }];
    expect(buildChartMarkers(inputs({ start: "2026-10-31", end: "2026-10-01", workouts: w }))).toEqual([]);
    expect(buildChartMarkers(inputs({ end: "not-a-date", workouts: w }))).toEqual([]);
  });

  it("a single day with a workout gives one sized, labelled marker", () => {
    const [m] = buildChartMarkers(inputs({ workouts: [{ date: "2026-10-05", sport: "functional_fitness", strain: 11.24 }] }));
    expect(m).toEqual({
      date: "2026-10-05",
      category: "workouts",
      kind: "workout",
      size: "md",
      label: "Mon, Oct 5: Functional Fitness (strain 11.2)",
    });
  });

  it("sizes the workout icon by its strain", () => {
    const sizes = buildChartMarkers(
      inputs({
        workouts: [
          { date: "2026-10-02", sport: "walking", strain: 4 },
          { date: "2026-10-03", sport: "running", strain: 12 },
          { date: "2026-10-04", sport: "running", strain: 16.5 },
          { date: "2026-10-06", sport: null, strain: null },
        ],
      }),
    ).map((m) => [m.date, m.size]);
    expect(sizes).toEqual([
      ["2026-10-02", "sm"],
      ["2026-10-03", "md"],
      ["2026-10-04", "lg"],
      ["2026-10-06", "sm"],
    ]);
  });

  it("merges same-day workouts and flags a high-strain cycle day", () => {
    const ms = buildChartMarkers(
      inputs({
        workouts: [
          { date: "2026-10-10", sport: "running", strain: 8 },
          { date: "2026-10-10", sport: "cycling", strain: 12.5 },
        ],
        cycles: [
          { date: "2026-10-10", strain: 15.3 },
          { date: "2026-10-11", strain: HIGH_STRAIN },
          { date: "2026-10-12", strain: 13.9 },
        ],
      }),
    );
    expect(ms).toHaveLength(2);
    expect(ms[0]).toMatchObject({ date: "2026-10-10", kind: "high-strain", size: "lg" });
    expect(ms[0].label).toBe("Sat, Oct 10: Running (strain 8.0), Cycling (strain 12.5) · high-strain day 15.3");
    // High strain with no logged workout still marks the day.
    expect(ms[1]).toMatchObject({ date: "2026-10-11", kind: "high-strain" });
    expect(ms[1].label).toBe("Sun, Oct 11: No logged workout · high-strain day 14.0");
  });

  it("journal: one marker per day naming the behaviour, truncated", () => {
    const ms = buildChartMarkers(
      inputs({
        journal: [
          { date: "2026-10-07", title: "Alcohol", tags: "late meal", mood: null },
          { date: "2026-10-07", title: null, tags: "caffeine", mood: "tired" },
          { date: "2026-10-08", title: null, tags: null, mood: null },
          { date: "2026-10-09", title: "x".repeat(200), tags: null },
        ],
      }),
    );
    expect(ms.map((m) => m.label)).toEqual([
      "Wed, Oct 7: Journal — Alcohol · late meal; caffeine · tired",
      "Thu, Oct 8: Journal — entry logged",
      `Fri, Oct 9: Journal — ${"x".repeat(59)}…`,
    ]);
  });

  it("big drop: day-over-day fall of >= 20 points only", () => {
    const ms = buildChartMarkers(
      inputs({
        recovery: [
          { date: "2026-10-01", recovery_score: 80 },
          { date: "2026-10-02", recovery_score: 60 }, // exactly 20 → marker
          { date: "2026-10-03", recovery_score: 41 }, // 19 → none
          { date: "2026-10-04", recovery_score: 90 },
          { date: "2026-10-06", recovery_score: 30 }, // gap → none
          { date: "2026-10-07", recovery_score: null },
          { date: "2026-10-08", recovery_score: 10 }, // prev is null → none
        ],
      }),
    );
    expect(BIG_DROP_POINTS).toBe(20);
    expect(ms).toEqual([
      {
        date: "2026-10-02",
        category: "drops",
        kind: "drop",
        size: "md",
        label: "Fri, Oct 2: Recovery dropped 20 points (80% → 60%)",
      },
    ]);
  });

  it("a drop on the window's first day uses the pre-window day; events outside the window are dropped", () => {
    const ms = buildChartMarkers(
      inputs({
        recovery: [
          { date: "2026-09-30", recovery_score: 90 },
          { date: "2026-10-01", recovery_score: 50 },
          { date: "2026-11-01", recovery_score: 10 },
        ],
        workouts: [{ date: "2026-09-30", sport: "running", strain: 9 }],
        journal: [{ date: "2026-11-01", title: "late", tags: null }],
      }),
    );
    expect(ms.map((m) => `${m.category}:${m.date}`)).toEqual(["drops:2026-10-01"]);
  });

  it("ignores malformed dates", () => {
    const ms = buildChartMarkers(
      inputs({
        workouts: [
          { date: "2026-10-32", sport: "running", strain: 9 },
          { date: "2026-10-5", sport: "running", strain: 9 },
          { date: "2026-10-05T07:00:00Z", sport: "running", strain: 9 },
        ],
      }),
    );
    expect(ms).toEqual([]);
  });

  it("'all' range start (0000-01-01) is accepted", () => {
    const ms = buildChartMarkers(
      inputs({ start: "0000-01-01", workouts: [{ date: "2019-03-10", sport: "rowing", strain: 7 }] }),
    );
    expect(ms.map((m) => m.date)).toEqual(["2019-03-10"]);
  });

  it("sorts by date then category on shared days", () => {
    const ms = buildChartMarkers(
      inputs({
        recovery: [
          { date: "2026-10-04", recovery_score: 90 },
          { date: "2026-10-05", recovery_score: 40 },
        ],
        journal: [{ date: "2026-10-05", title: "Alcohol", tags: null }],
        workouts: [
          { date: "2026-10-05", sport: "running", strain: 9 },
          { date: "2026-10-03", sport: "running", strain: 9 },
        ],
      }),
    );
    expect(ms.map((m) => `${m.date}:${m.category}`)).toEqual([
      "2026-10-03:workouts",
      "2026-10-05:workouts",
      "2026-10-05:journal",
      "2026-10-05:drops",
    ]);
  });
});

describe("DST and timezone boundaries", () => {
  const tzBefore = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tzBefore;
    vi.useRealTimers();
  });

  it("dayDiff is exact across US spring-forward and fall-back", () => {
    expect(dayDiff("2026-03-07", "2026-03-08")).toBe(1);
    expect(dayDiff("2026-03-08", "2026-03-09")).toBe(1);
    expect(dayDiff("2026-10-31", "2026-11-01")).toBe(1);
    expect(dayDiff("2026-11-01", "2026-11-02")).toBe(1);
    expect(dayDiff("2026-02-28", "2026-03-01")).toBe(1);
    expect(dayDiff("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("drops across DST transitions are still day-over-day, labels keep the stored date", () => {
    for (const tz of ["America/New_York", "Australia/Lord_Howe", "Pacific/Chatham", "UTC"]) {
      process.env.TZ = tz;
      const ms = buildChartMarkers(
        inputs({
          start: "2026-03-01",
          end: "2026-11-30",
          recovery: [
            { date: "2026-03-07", recovery_score: 90 },
            { date: "2026-03-08", recovery_score: 50 },
            { date: "2026-10-31", recovery_score: 85 },
            { date: "2026-11-01", recovery_score: 40 },
          ],
        }),
      );
      expect(ms.map((m) => m.label)).toEqual([
        "Sun, Mar 8: Recovery dropped 40 points (90% → 50%)",
        "Sun, Nov 1: Recovery dropped 45 points (85% → 40%)",
      ]);
    }
  });

  it("formatMarkerDate never shifts the day", () => {
    process.env.TZ = "Pacific/Kiritimati"; // UTC+14
    expect(formatMarkerDate("2026-11-01")).toBe("Sun, Nov 1");
    process.env.TZ = "Pacific/Pago_Pago"; // UTC-11
    expect(formatMarkerDate("2026-11-01")).toBe("Sun, Nov 1");
  });
});

describe("placeMarkers", () => {
  const plotted = days("2026-10-01", 31);

  it("fewer than two plotted points: nothing to place on", () => {
    const ms = buildChartMarkers(inputs({ workouts: [{ date: "2026-10-01", sport: "running", strain: 9 }] }));
    expect(placeMarkers(ms, [])).toEqual([]);
    expect(placeMarkers(ms, ["2026-10-01"])).toEqual([]);
  });

  it("aligns each marker to its date's index on the chart's x scale", () => {
    const ms = buildChartMarkers(
      inputs({
        workouts: [
          { date: "2026-10-01", sport: "running", strain: 9 },
          { date: "2026-10-16", sport: "running", strain: 9 },
          { date: "2026-10-31", sport: "running", strain: 9 },
        ],
      }),
    );
    expect(placeMarkers(ms, plotted).map((m) => [m.date, m.xPct])).toEqual([
      ["2026-10-01", 0],
      ["2026-10-16", 50],
      ["2026-10-31", 100],
    ]);
  });

  it("charts plot only non-null points: alignment follows plotted order and skips unplotted dates", () => {
    // Oct 2 has no score, so the chart's 2nd point is Oct 3.
    const sparse = ["2026-10-01", "2026-10-03", "2026-10-04"];
    const ms = buildChartMarkers(
      inputs({
        workouts: [
          { date: "2026-10-02", sport: "running", strain: 9 },
          { date: "2026-10-03", sport: "running", strain: 9 },
        ],
      }),
    );
    expect(placeMarkers(ms, sparse).map((m) => [m.date, m.xPct])).toEqual([["2026-10-03", 50]]);
  });

  it("overlapping categories on one day stay separate (one per lane)", () => {
    const ms = buildChartMarkers(
      inputs({
        recovery: [
          { date: "2026-10-09", recovery_score: 90 },
          { date: "2026-10-10", recovery_score: 40 },
        ],
        workouts: [{ date: "2026-10-10", sport: "running", strain: 9 }],
        journal: [{ date: "2026-10-10", title: "Alcohol", tags: null }],
      }),
    );
    const placed = placeMarkers(ms, plotted, { minGapPct: 2.5 });
    expect(placed.map((m) => [m.category, m.xPct, m.count])).toEqual([
      ["workouts", 30, 1],
      ["journal", 30, 1],
      ["drops", 30, 1],
    ]);
  });

  it("hidden categories are dropped", () => {
    const ms = buildChartMarkers(
      inputs({
        workouts: [{ date: "2026-10-10", sport: "running", strain: 9 }],
        journal: [{ date: "2026-10-10", title: "Alcohol", tags: null }],
      }),
    );
    expect(placeMarkers(ms, plotted, { hidden: new Set(["workouts"]) }).map((m) => m.category)).toEqual(["journal"]);
  });

  it("dense ranges cluster neighbours within one lane and keep every event in the label", () => {
    const plotted365 = days("2025-11-28", 365);
    const daily = plotted365.map((date, i) => ({ date, sport: "running", strain: i % 3 === 0 ? 16 : 6 }));
    const ms = buildChartMarkers(inputs({ start: "2025-11-28", end: "2026-11-27", workouts: daily }));
    expect(ms).toHaveLength(365);
    const placed = placeMarkers(ms, plotted365, { minGapPct: 2.5 });
    // 2.5% of 364 index steps ≈ 9.1 days per cluster.
    expect(placed.length).toBeGreaterThan(35);
    expect(placed.length).toBeLessThan(45);
    expect(placed.reduce((n, m) => n + m.count, 0)).toBe(365);
    for (let i = 1; i < placed.length; i++) {
      expect(placed[i].xPct - placed[i - 1].xPct).toBeGreaterThanOrEqual(2.5);
    }
    const first = placed[0];
    expect(first.count).toBeGreaterThan(1);
    expect(first.size).toBe("lg");
    expect(first.label).toMatch(/^\d+ workout days, Fri, Nov 28 – /);
    expect(first.label).toContain("Fri, Nov 28: Running (strain 16.0)");
  });

  it("no clustering without a gap", () => {
    const ms = buildChartMarkers(
      inputs({ workouts: plotted.map((date) => ({ date, sport: "running", strain: 9 })) }),
    );
    expect(placeMarkers(ms, plotted)).toHaveLength(31);
  });
});
