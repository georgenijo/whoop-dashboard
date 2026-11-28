import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/analytics/dayDetail";
import {
  BASELINE_MIN_DAYS,
  PALETTES,
  buildTodayCard,
  compareToBaseline,
  median,
  parseShareOptions,
  shareFilename,
  shareQuery,
  sleepBand,
  strainBand,
  type ShareTileKey,
  type TodayCardModel,
} from "./todayCard";
import { cyc, fullDay, input, priorDays, rec, slp, wo } from "./__fixtures__/shareRows";

const tile = (m: TodayCardModel, key: ShareTileKey) => m.tiles.find((t) => t.key === key)!;

/** Every user-visible string on the card except the date itself. */
function cardText(m: TodayCardModel): string[] {
  return [m.dayLabel, m.recap, ...m.tiles.flatMap((t) => [t.label, t.value, t.band, t.detail])].filter(
    (s): s is string => typeof s === "string",
  );
}

describe("buildTodayCard — full day", () => {
  const m = buildTodayCard(fullDay());

  it("shows today with every section in fixed order", () => {
    expect(m.date).toBe("2026-11-27");
    expect(m.dayLabel).toBe("Today");
    expect(m.dateLabel).toBe("Friday, Nov 27, 2026");
    expect(m.isToday).toBe(true);
    expect(m.hasAnyData).toBe(true);
    expect(m.tiles.map((t) => t.key)).toEqual(["recovery", "sleep", "strain", "hrv", "rhr"]);
    expect(m.tiles.every((t) => !t.missing)).toBe(true);
  });

  it("formats numbers and bands", () => {
    expect(tile(m, "recovery")).toMatchObject({ value: "68%", band: "Green", tone: "green" });
    // 3.9 + 1.6 + 2.2 h asleep = 7h 42m; 92% performance → Optimal.
    expect(tile(m, "sleep")).toMatchObject({ value: "7h 42m", band: "Optimal", tone: "green", detail: "92% performance" });
    expect(tile(m, "strain")).toMatchObject({ label: "Strain so far", value: "12.4", band: "Moderate", detail: "1 workout" });
    // HRV 64 vs usual 60 (+6.7%) → above; RHR 52 vs 54 (-3.7%) → usual.
    expect(tile(m, "hrv")).toMatchObject({ value: "64 ms", band: "Above usual", tone: "green", detail: "30-day usual 60 ms" });
    expect(tile(m, "rhr")).toMatchObject({ value: "52 bpm", band: "Usual", tone: "neutral" });
  });

  it("writes a one-line recap from the numbers, with no sport names", () => {
    expect(m.recap).toBe("Green recovery at 68%, 7h 42m asleep, strain 12.4 so far with 1 workout.");
    expect(m.recap).not.toMatch(/Running/);
  });

  it("uses only ASCII, so the PNG never needs a fallback font", () => {
    for (const s of [...cardText(m), m.dateLabel]) expect(s).toMatch(/^[\x20-\x7e]*$/);
  });
});

describe("buildTodayCard — hide numbers", () => {
  const m = buildTodayCard(fullDay("2026-11-27", { hideNumbers: true, workouts: [wo("2026-11-27", "a"), wo("2026-11-27", "b")] }));

  it("drops every number but keeps bands and colours", () => {
    expect(m.hideNumbers).toBe(true);
    for (const t of m.tiles) {
      expect(t.value).toBeNull();
      expect(t.detail).toBeNull();
    }
    expect(tile(m, "recovery")).toMatchObject({ band: "Green", tone: "green" });
    expect(tile(m, "sleep")).toMatchObject({ band: "Optimal", tone: "green" });
    expect(tile(m, "strain").band).toBe("Moderate");
    expect(tile(m, "hrv").band).toBe("Above usual");
  });

  it("has no digits anywhere on the card except the date", () => {
    for (const s of cardText(m)) expect(s).not.toMatch(/\d/);
    expect(m.recap).toBe("Green recovery, optimal sleep, moderate strain so far with workouts.");
  });

  it("says a reading exists when there is no baseline to band it against", () => {
    const thin = buildTodayCard(fullDay("2026-11-27", { hideNumbers: true, recovery: [rec("2026-11-27")] }));
    expect(tile(thin, "hrv")).toMatchObject({ value: null, band: "Recorded", tone: "neutral", missing: false });
  });
});

describe("buildTodayCard — missing sections, nulls, empty", () => {
  it("no data at all today or yesterday → empty today card", () => {
    const m = buildTodayCard(input());
    expect(m.date).toBe("2026-11-27");
    expect(m.dayLabel).toBe("Today");
    expect(m.hasAnyData).toBe(false);
    expect(m.tiles.every((t) => t.missing && t.band === "Not synced yet" && t.value === null)).toBe(true);
    expect(m.recap).toBe("Nothing has synced for today yet.");
  });

  it("falls back to yesterday (labelled) when today has nothing yet", () => {
    const y = "2026-11-26";
    const m = buildTodayCard(input({ recovery: [rec(y)], sleep: [slp(y)], cycles: [cyc(y)] }));
    expect(m.date).toBe(y);
    expect(m.dayLabel).toBe("Yesterday");
    expect(m.isToday).toBe(false);
    expect(tile(m, "strain").label).toBe("Strain");
    expect(m.recap).toBe("Green recovery at 68%, 7h 42m asleep, strain 12.4.");
  });

  it("stays on today once anything for today has synced, even if yesterday is fuller", () => {
    const m = buildTodayCard(
      input({ recovery: [rec("2026-11-27")], sleep: [slp("2026-11-26")], cycles: [cyc("2026-11-26")] }),
    );
    expect(m.date).toBe("2026-11-27");
    expect(tile(m, "sleep")).toMatchObject({ missing: true, band: "Not synced yet" });
    expect(tile(m, "strain").missing).toBe(true);
    expect(m.recap).toBe("Green recovery at 68%.");
  });

  it("recovery row with a null score but an HRV keeps HRV and marks recovery missing", () => {
    const m = buildTodayCard(input({ recovery: [rec("2026-11-27", { recovery_score: null })] }));
    expect(tile(m, "recovery").missing).toBe(true);
    expect(tile(m, "hrv")).toMatchObject({ value: "64 ms", band: null, missing: false });
    expect(m.hasAnyData).toBe(true);
    expect(m.recap).toBe("Some data was recorded, but no headline metrics.");
  });

  it("NaN and null metrics count as missing", () => {
    const m = buildTodayCard(
      input({
        recovery: [rec("2026-11-27", { recovery_score: Number.NaN, hrv: null, rhr: null })],
        cycles: [cyc("2026-11-27", { strain: null })],
      }),
    );
    expect(m.tiles.every((t) => t.missing)).toBe(true);
  });

  it("sleep without a performance score bands on asleep / need", () => {
    const m = buildTodayCard(input({ sleep: [slp("2026-11-27", { performance: null })] }));
    // 7.7h asleep / 8h need = 96% → Optimal, but no "% performance" detail.
    expect(tile(m, "sleep")).toMatchObject({ value: "7h 42m", band: "Optimal", detail: null });
  });

  it("sleep with neither performance nor need has no band in number mode", () => {
    const m = buildTodayCard(input({ sleep: [slp("2026-11-27", { performance: null, sleep_need_ms: null })] }));
    expect(tile(m, "sleep")).toMatchObject({ value: "7h 42m", band: null, tone: "neutral" });
  });

  it("workouts with no cycle row still count toward the recap", () => {
    const m = buildTodayCard(input({ workouts: [wo("2026-11-27", "w")] }));
    expect(tile(m, "strain").missing).toBe(true);
    expect(m.hasAnyData).toBe(true);
    expect(m.recap).toBe("1 workout.");
  });

  it("a strain day with no workouts says so", () => {
    const m = buildTodayCard(input({ cycles: [cyc("2026-11-27", { strain: 4.2 })] }));
    expect(tile(m, "strain")).toMatchObject({ value: "4.2", band: "Light", detail: "No workouts" });
  });

  it("ignores rows for other days (only the card's day is read)", () => {
    const m = buildTodayCard(input({ cycles: [cyc("2026-11-27"), cyc("2026-11-20", { strain: 20 })] }));
    expect(tile(m, "strain").value).toBe("12.4");
  });
});

describe("HRV / RHR baseline", () => {
  const today = "2026-11-27";

  it(`needs at least ${BASELINE_MIN_DAYS} prior readings`, () => {
    const few = buildTodayCard(input({ recovery: [rec(today), ...priorDays(today, BASELINE_MIN_DAYS - 1)] }));
    expect(tile(few, "hrv")).toMatchObject({ band: null, detail: null });
    const enough = buildTodayCard(input({ recovery: [rec(today), ...priorDays(today, BASELINE_MIN_DAYS)] }));
    expect(tile(enough, "hrv").band).toBe("Above usual");
  });

  it("uses only the 30 days strictly before the card's day (gaps and old rows ignored)", () => {
    const rows = [
      rec(today, { hrv: 64 }),
      // 7 readings with gaps inside the window
      ...[1, 3, 6, 10, 15, 22, 30].map((d) => rec(addDays(today, -d), { hrv: 80 })),
      // outside the window (31+ days back): would drag the median down if counted
      rec(addDays(today, -31), { hrv: 10 }),
      rec("2026-10-01", { hrv: 10 }),
    ];
    const m = buildTodayCard(input({ recovery: rows }));
    expect(tile(m, "hrv")).toMatchObject({ band: "Below usual", tone: "yellow", detail: "30-day usual 80 ms" });
  });

  it("RHR above usual is the warning direction", () => {
    const m = buildTodayCard(input({ recovery: [rec(today, { rhr: 60 }), ...priorDays(today, 10, 60, 54)] }));
    expect(tile(m, "rhr")).toMatchObject({ band: "Above usual", tone: "yellow" });
    const low = buildTodayCard(input({ recovery: [rec(today, { rhr: 48 }), ...priorDays(today, 10, 60, 54)] }));
    expect(tile(low, "rhr")).toMatchObject({ band: "Below usual", tone: "green" });
  });

  it("baseline window is computed from yesterday when the card falls back", () => {
    const y = "2026-11-26";
    // Prior days relative to yesterday; today's empty, so the card shows y.
    const m = buildTodayCard(input({ recovery: [rec(y, { hrv: 50 }), ...priorDays(y, 8, 60)] }));
    expect(m.date).toBe(y);
    expect(tile(m, "hrv")).toMatchObject({ band: "Below usual", detail: "30-day usual 60 ms" });
  });
});

describe("date boundaries", () => {
  it("month and year rollovers pick the right yesterday", () => {
    const m = buildTodayCard(input({ today: "2027-01-01", recovery: [rec("2026-12-31")] }));
    expect(m.date).toBe("2026-12-31");
    expect(m.dateLabel).toBe("Thursday, Dec 31, 2026");
    const leap = buildTodayCard(input({ today: "2028-03-01", cycles: [cyc("2028-02-29")] }));
    expect(leap.date).toBe("2028-02-29");
  });

  it("a baseline spanning the US spring-forward DST change counts whole calendar days", () => {
    // 2026-03-08 is the DST change in America/New_York; the window is pure
    // calendar-date math, so every prior day is counted exactly once.
    const today = "2026-03-10";
    const m = buildTodayCard(input({ today, tz: "America/New_York", recovery: [rec(today, { hrv: 64 }), ...priorDays(today, 30, 60)] }));
    expect(tile(m, "hrv").detail).toBe("30-day usual 60 ms");
    const justOut = buildTodayCard(
      input({ today, recovery: [rec(today, { hrv: 64 }), ...priorDays(today, 6, 60), rec("2026-02-08", { hrv: 60 })] }),
    );
    // 2026-02-08 is 30 days before → inside; 6 + 1 = 7 readings → banded.
    expect(tile(justOut, "hrv").band).toBe("Above usual");
  });
});

describe("theme", () => {
  it("carries the selected palette", () => {
    expect(buildTodayCard(fullDay()).palette).toBe(PALETTES.dark);
    const light = buildTodayCard(fullDay("2026-11-27", { theme: "light" }));
    expect(light.theme).toBe("light");
    expect(light.palette).toBe(PALETTES.light);
    expect(light.palette.background).not.toBe(PALETTES.dark.background);
  });

  it("theme does not change any text", () => {
    const d = buildTodayCard(fullDay());
    const l = buildTodayCard(fullDay("2026-11-27", { theme: "light" }));
    expect(cardText(l)).toEqual(cardText(d));
  });
});

describe("helpers", () => {
  it("parseShareOptions accepts only exact values", () => {
    expect(parseShareOptions({})).toEqual({ hideNumbers: false, theme: "dark" });
    expect(parseShareOptions({ hide: "1", theme: "light" })).toEqual({ hideNumbers: true, theme: "light" });
    expect(parseShareOptions({ hide: "true", theme: "LIGHT" })).toEqual({ hideNumbers: false, theme: "dark" });
    expect(parseShareOptions({ hide: ["1", "0"], theme: ["light"] })).toEqual({ hideNumbers: true, theme: "light" });
    expect(parseShareOptions({ hide: null, theme: null })).toEqual({ hideNumbers: false, theme: "dark" });
  });

  it("shareQuery round-trips and omits defaults", () => {
    expect(shareQuery({ hideNumbers: false, theme: "dark" })).toBe("");
    expect(shareQuery({ hideNumbers: true, theme: "light" })).toBe("?hide=1&theme=light");
    const q = new URLSearchParams(shareQuery({ hideNumbers: true, theme: "dark" }).slice(1));
    expect(parseShareOptions({ hide: q.get("hide"), theme: q.get("theme") })).toEqual({ hideNumbers: true, theme: "dark" });
  });

  it("filename has the date and nothing else", () => {
    expect(shareFilename("2026-11-27")).toBe("coach-day-2026-11-27.png");
  });

  it("bands use Whoop's thresholds", () => {
    expect([85, 84.9, 70, 69.9].map((p) => sleepBand(p).band)).toEqual(["Optimal", "Sufficient", "Sufficient", "Poor"]);
    expect([0, 9.9, 10, 13.9, 14, 17.9, 18, 21].map(strainBand)).toEqual([
      "Light", "Light", "Moderate", "Moderate", "High", "High", "All out", "All out",
    ]);
  });

  it("median and baseline compare", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([1, Number.NaN, 3])).toBe(2);
    expect(compareToBaseline(105, 100)).toBe("usual");
    expect(compareToBaseline(105.1, 100)).toBe("above");
    expect(compareToBaseline(94.9, 100)).toBe("below");
    expect(compareToBaseline(50, null)).toBeNull();
    expect(compareToBaseline(50, 0)).toBeNull();
  });
});
