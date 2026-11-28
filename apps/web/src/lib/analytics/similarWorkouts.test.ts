// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  compareSimilarWorkouts,
  computeVsUsualChips,
  formatPace,
  isBefore,
  lookbackStart,
  monthEnd,
  monthNoteFor,
  paceSecPerKm,
  pickSimilar,
  zoneMix,
  type SimilarWorkoutInput,
} from "./similarWorkouts";

let seq = 0;
function w(over: Partial<SimilarWorkoutInput> = {}): SimilarWorkoutInput {
  seq += 1;
  return {
    id: over.id ?? `w${seq}`,
    date: "2026-11-10",
    sport: "Running",
    duration_sec: 3600,
    avg_hr: 150,
    max_hr: 175,
    strain: 12,
    distance_m: 10_000,
    zone_0_ms: 0,
    zone_1_ms: 600_000,
    zone_2_ms: 1_200_000,
    zone_3_ms: 1_200_000,
    zone_4_ms: 480_000,
    zone_5_ms: 120_000,
    start_utc: null,
    ...over,
  };
}

const target = (over: Partial<SimilarWorkoutInput> = {}) =>
  w({ id: "target", date: "2026-11-20", ...over });

describe("compareSimilarWorkouts — gating", () => {
  it("empty pool → first-of-sport with zero same-sport history", () => {
    const r = compareSimilarWorkouts(target(), []);
    expect(r).toEqual({ status: "first-of-sport", sport: "Running", sameSportCount: 0, monthNote: null });
  });

  it("null / zero / NaN duration → no-duration", () => {
    for (const d of [null, 0, Number.NaN, -10]) {
      expect(compareSimilarWorkouts(target({ duration_sec: d }), [w()]).status).toBe("no-duration");
    }
  });

  it("very short sessions (< 5 min) are not compared", () => {
    expect(compareSimilarWorkouts(target({ duration_sec: 299 }), [w({ duration_sec: 299 })]).status).toBe(
      "too-short",
    );
    expect(compareSimilarWorkouts(target({ duration_sec: 300 }), [w({ duration_sec: 300 })]).status).toBe("ok");
  });

  it("same sport but no similar duration → first-of-sport with the earlier count", () => {
    const r = compareSimilarWorkouts(target(), [w({ duration_sec: 1200 }), w({ duration_sec: 9000 })]);
    expect(r.status).toBe("first-of-sport");
    if (r.status === "first-of-sport") expect(r.sameSportCount).toBe(2);
  });

  it("the target itself in the pool is ignored", () => {
    const t = target();
    expect(compareSimilarWorkouts(t, [t]).status).toBe("first-of-sport");
  });
});

describe("pickSimilar", () => {
  it("applies ±25% inclusively and drops outside the band", () => {
    const pool = [
      w({ id: "lo-in", duration_sec: 2700 }), // exactly −25%
      w({ id: "hi-in", duration_sec: 4500 }), // exactly +25%
      w({ id: "lo-out", duration_sec: 2699 }),
      w({ id: "hi-out", duration_sec: 4501 }),
    ];
    expect(pickSimilar(target(), pool).map((x) => x.id).sort()).toEqual(["hi-in", "lo-in"]);
  });

  it("matches sport trimmed + case-insensitively; null sport only matches null/blank", () => {
    const pool = [
      w({ id: "a", sport: " running " }),
      w({ id: "b", sport: "Cycling" }),
      w({ id: "c", sport: null }),
      w({ id: "d", sport: "" }),
    ];
    expect(pickSimilar(target(), pool).map((x) => x.id)).toEqual(["a"]);
    expect(pickSimilar(target({ sport: null }), pool).map((x) => x.id).sort()).toEqual(["c", "d"]);
  });

  it("only uses strictly-earlier sessions, newest first, capped at 5", () => {
    const pool = [
      w({ id: "later", date: "2026-11-25" }),
      ...[1, 2, 3, 4, 5, 6, 7].map((d) => w({ id: `d${d}`, date: `2026-11-0${d}` })),
    ];
    expect(pickSimilar(target(), pool).map((x) => x.id)).toEqual(["d7", "d6", "d5", "d4", "d3"]);
  });

  it("same-day sessions are ordered by start_utc, with an id tiebreak when equal", () => {
    const t = target({ date: "2026-11-20", start_utc: "2026-11-20T18:00:00Z" });
    const am = w({ id: "am", date: "2026-11-20", start_utc: "2026-11-20T07:00:00Z" });
    const pm = w({ id: "pm", date: "2026-11-20", start_utc: "2026-11-20T21:00:00Z" });
    expect(pickSimilar(t, [am, pm]).map((x) => x.id)).toEqual(["am"]);
    // Same instant: deterministic by id.
    const a = w({ id: "a", start_utc: "2026-11-20T07:00:00Z" });
    const b = w({ id: "b", start_utc: "2026-11-20T07:00:00Z" });
    expect(isBefore(a, b)).toBe(true);
    expect(isBefore(b, a)).toBe(false);
  });

  it("orders by UTC instant across a DST change, not by wall clock", () => {
    // US DST ended 2026-11-01 at 2:00 local. 01:30 EDT (05:30Z) precedes
    // 01:15 EST (06:15Z) even though its wall clock reads later.
    const edt = w({ id: "edt", date: "2026-11-01", start_utc: "2026-11-01T05:30:00Z" });
    const est = target({ date: "2026-11-01", start_utc: "2026-11-01T06:15:00Z" });
    expect(pickSimilar(est, [edt]).map((x) => x.id)).toEqual(["edt"]);
  });

  it("falls back to the local date when start_utc is missing or unparseable", () => {
    const t = target({ date: "2026-11-20", start_utc: null });
    const prev = w({ id: "prev", date: "2026-11-19", start_utc: "garbage" });
    expect(pickSimilar(t, [prev]).map((x) => x.id)).toEqual(["prev"]);
  });
});

describe("metrics, units and nulls", () => {
  it("baselines average only the sessions that have the metric", () => {
    const r = compareSimilarWorkouts(target({ avg_hr: 160 }), [
      w({ avg_hr: 150 }),
      w({ avg_hr: null }),
      w({ avg_hr: 140 }),
    ]);
    if (r.status !== "ok") throw new Error(r.status);
    const hr = r.metrics.find((m) => m.key === "avg_hr")!;
    expect(hr).toMatchObject({ current: 160, baseline: 145, delta: 15, n: 2 });
  });

  it("distance/pace are null when not recorded (0 or null metres) and never NaN", () => {
    const r = compareSimilarWorkouts(target({ distance_m: 0 }), [w({ distance_m: null }), w({ distance_m: 0 })]);
    if (r.status !== "ok") throw new Error(r.status);
    for (const key of ["distance_km", "pace_sec_per_km"] as const) {
      expect(r.metrics.find((m) => m.key === key)).toMatchObject({ current: null, baseline: null, delta: null, n: 0 });
    }
  });

  it("normalises metres → km and pace to sec/km", () => {
    expect(paceSecPerKm(w({ duration_sec: 3000, distance_m: 10_000 }))).toBe(300);
    expect(formatPace(300)).toBe("5:00/km");
    expect(formatPace(359.6)).toBe("6:00/km");
    expect(formatPace(null)).toBe("—");
    expect(paceSecPerKm(w({ distance_m: 5 }))).toBeNull(); // < 10 m is noise
  });

  it("zone mix is a share of the session's own zone total, so totals ≠ duration still compare", () => {
    const z = zoneMix(w({ zone_0_ms: 0, zone_1_ms: 1, zone_2_ms: 1, zone_3_ms: 1, zone_4_ms: 1, zone_5_ms: 0 }))!;
    expect(z.easy).toBeCloseTo(50);
    expect(z.moderate).toBeCloseTo(25);
    expect(z.hard).toBeCloseTo(25);
    expect(zoneMix(w({ zone_0_ms: null, zone_1_ms: null, zone_2_ms: 0, zone_3_ms: null, zone_4_ms: null, zone_5_ms: null }))).toBeNull();
  });

  it("missing zones on the target still produces a baseline mix", () => {
    const r = compareSimilarWorkouts(
      target({ zone_0_ms: null, zone_1_ms: null, zone_2_ms: null, zone_3_ms: null, zone_4_ms: null, zone_5_ms: null }),
      [w()],
    );
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.zones.current).toBeNull();
    expect(r.zones.baseline).not.toBeNull();
    expect(r.zones.n).toBe(1);
  });
});

describe("verdict", () => {
  const base = [w({ avg_hr: 150, strain: 12 }), w({ avg_hr: 150, strain: 12 })];

  it("higher intensity when HR and/or strain are clearly up", () => {
    const r = compareSimilarWorkouts(target({ avg_hr: 158, strain: 14 }), base);
    expect(r.status === "ok" && r.verdict).toBe("higher-intensity");
    expect(r.status === "ok" && r.notes[0]).toBe("Higher intensity than usual");
  });

  it("easier when both are down", () => {
    const r = compareSimilarWorkouts(target({ avg_hr: 140, strain: 9 }), base);
    expect(r.status === "ok" && r.verdict).toBe("lower-intensity");
  });

  it("typical inside the bands", () => {
    const r = compareSimilarWorkouts(target({ avg_hr: 152, strain: 12.5 }), base);
    expect(r.status === "ok" && r.verdict).toBe("typical");
  });

  it("mixed when HR and strain disagree", () => {
    const r = compareSimilarWorkouts(target({ avg_hr: 160, strain: 9 }), base);
    expect(r.status === "ok" && r.verdict).toBe("mixed");
  });

  it("typical (not a crash) when no intensity metric is available at all", () => {
    const r = compareSimilarWorkouts(target({ avg_hr: null, strain: null }), base);
    expect(r.status === "ok" && r.verdict).toBe("typical");
  });

  it("adds zone and pace notes past their thresholds", () => {
    const hard = target({ zone_1_ms: 0, zone_2_ms: 0, zone_3_ms: 0, zone_4_ms: 1, zone_5_ms: 1, duration_sec: 3000 });
    const r = compareSimilarWorkouts(hard, [w({ duration_sec: 3600 })]);
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.notes.some((n) => /more time in Z4–5/.test(n))).toBe(true);
    expect(r.notes).toContain("Faster pace than usual");
  });
});

describe("month note", () => {
  it("longest of the sport this month, counting later sessions in the month too", () => {
    const t = target({ date: "2026-11-15", duration_sec: 4000 });
    expect(monthNoteFor(t, [w({ date: "2026-11-02", duration_sec: 3600 })])).toEqual({ kind: "longest", others: 1 });
    expect(monthNoteFor(t, [w({ date: "2026-11-28", duration_sec: 4200 })])).toBeNull();
  });

  it("ties are reported as tied, at whole-second resolution", () => {
    const t = target({ duration_sec: 3600.4 });
    expect(monthNoteFor(t, [w({ date: "2026-11-02", duration_sec: 3600 })])).toEqual({ kind: "tied-longest", others: 1 });
  });

  it("silent when the session is alone in its month, or the others are other months/sports", () => {
    const t = target({ date: "2026-11-01" });
    expect(monthNoteFor(t, [])).toBeNull();
    expect(monthNoteFor(t, [w({ date: "2026-10-31" }), w({ date: "2026-11-05", sport: "Cycling" })])).toBeNull();
  });

  it("surfaces in notes", () => {
    const r = compareSimilarWorkouts(target({ duration_sec: 4000 }), [w({ date: "2026-11-02", duration_sec: 3600 })]);
    expect(r.status === "ok" && r.notes).toContain("Longest running this month");
  });
});

describe("date helpers", () => {
  it("lookbackStart is DST- and leap-safe", () => {
    expect(lookbackStart("2026-03-09", 1)).toBe("2026-03-08"); // US DST start
    expect(lookbackStart("2026-11-02", 1)).toBe("2026-11-01"); // US DST end
    expect(lookbackStart("2028-03-01", 1)).toBe("2028-02-29");
    expect(lookbackStart("2026-11-20")).toBe("2025-11-20");
    expect(lookbackStart("bad")).toBe("bad");
  });

  it("monthEnd handles leap years and December", () => {
    expect(monthEnd("2028-02-10")).toBe("2028-02-29");
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(monthEnd("2026-12-01")).toBe("2026-12-31");
    expect(monthEnd("nope")).toBe("nope");
  });
});

describe("computeVsUsualChips", () => {
  it("is empty for empty input and a single session", () => {
    expect(computeVsUsualChips([])).toEqual({});
    expect(computeVsUsualChips([w()])).toEqual({});
  });

  it("only chips rows that have an earlier similar session", () => {
    const rows = [
      w({ id: "new", date: "2026-11-20", avg_hr: 165, strain: 15 }),
      w({ id: "old", date: "2026-11-10" }),
      w({ id: "bike", date: "2026-11-15", sport: "Cycling" }),
    ];
    const chips = computeVsUsualChips(rows);
    expect(Object.keys(chips)).toEqual(["new"]);
    expect(chips.new).toEqual({ verdict: "higher-intensity", n: 1, label: "↑ harder" });
  });
});
