import { describe, expect, it } from "vitest";
import {
  baseItems,
  dateItems,
  daysBetween,
  DESTINATIONS,
  filterItems,
  formatDateLabel,
  fuzzyScore,
  isValidIsoDate,
  localIsoDate,
  MAX_RESULTS,
  paletteResults,
  parseDateQuery,
  rangeCovering,
  shiftIso,
} from "./palette";

// 2026-11-27 is a Friday.
const TODAY = "2026-11-27";
const ctx = { pathname: "/", range: null };

describe("fuzzyScore", () => {
  it("empty query matches everything with score 0", () => {
    expect(fuzzyScore("", "Sleep")).toBe(0);
    expect(fuzzyScore("   ", "Sleep")).toBe(0);
  });
  it("is case-insensitive subsequence matching", () => {
    expect(fuzzyScore("SLP", "Sleep")).not.toBeNull();
    expect(fuzzyScore("wko", "Workouts")).not.toBeNull();
  });
  it("rejects out-of-order or missing characters", () => {
    expect(fuzzyScore("pls", "Sleep")).toBeNull();
    expect(fuzzyScore("sleepz", "Sleep")).toBeNull();
  });
  it("prefers prefix and contiguous matches", () => {
    expect(fuzzyScore("st", "Strain")!).toBeGreaterThan(fuzzyScore("st", "Settings")!);
    expect(fuzzyScore("rec", "Recovery")!).toBeGreaterThan(fuzzyScore("rec", "Performance score")!);
  });
  it("rewards word starts", () => {
    expect(fuzzyScore("rhr", "resting heart rate")!).toBeGreaterThan(fuzzyScore("rhr", "rhythmicr")!);
  });
  it("ignores whitespace in the query", () => {
    expect(fuzzyScore("go to", "Go to today")).not.toBeNull();
  });
});

describe("filterItems", () => {
  const items = baseItems(ctx);
  it("returns every item for an empty query", () => {
    expect(filterItems(items, "")).toEqual(items);
  });
  it("ranks the obvious page first", () => {
    expect(filterItems(items, "sle")[0].label).toBe("Sleep");
    expect(filterItems(items, "coach")[0].label).toBe("Coach");
    expect(filterItems(items, "set")[0].label).toBe("Settings");
  });
  it("matches keywords (synonyms)", () => {
    expect(filterItems(items, "hrv")[0].label).toBe("Recovery");
    expect(filterItems(items, "chat")[0].label).toBe("Coach");
  });
  it("returns [] when nothing matches", () => {
    expect(filterItems(items, "zzzzqx")).toEqual([]);
  });
  it("does not mutate the input", () => {
    const copy = [...items];
    filterItems(items, "s");
    expect(items).toEqual(copy);
  });
});

describe("isValidIsoDate / shiftIso / daysBetween", () => {
  it("validates real calendar dates", () => {
    expect(isValidIsoDate("2026-11-02")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-1-1")).toBe(false);
  });
  it("crosses month/year boundaries", () => {
    expect(shiftIso("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftIso("2024-02-28", 1)).toBe("2024-02-29");
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
  });
  it("is immune to DST transitions (US: 2026-03-08, 2026-11-01)", () => {
    expect(shiftIso("2026-03-08", -1)).toBe("2026-03-07");
    expect(shiftIso("2026-11-01", 1)).toBe("2026-11-02");
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });
});

describe("parseDateQuery", () => {
  it("parses ISO dates, rejecting impossible ones", () => {
    expect(parseDateQuery("2026-11-02", TODAY)).toBe("2026-11-02");
    expect(parseDateQuery(" 2026-11-02 ", TODAY)).toBe("2026-11-02");
    expect(parseDateQuery("2026-02-30", TODAY)).toBeNull();
  });
  it("parses today / yesterday", () => {
    expect(parseDateQuery("today", TODAY)).toBe(TODAY);
    expect(parseDateQuery("Yesterday", TODAY)).toBe("2026-11-26");
    expect(parseDateQuery("yesterday", "2026-01-01")).toBe("2025-12-31");
  });
  it("parses N days ago", () => {
    expect(parseDateQuery("3 days ago", TODAY)).toBe("2026-11-24");
    expect(parseDateQuery("1 day ago", TODAY)).toBe("2026-11-26");
    expect(parseDateQuery("10d ago", TODAY)).toBe("2026-11-17");
    expect(parseDateQuery("0 days ago", TODAY)).toBe(TODAY);
  });
  it("bare weekday = most recent, today included", () => {
    expect(parseDateQuery("friday", TODAY)).toBe(TODAY);
    expect(parseDateQuery("monday", TODAY)).toBe("2026-11-23");
    expect(parseDateQuery("sat", TODAY)).toBe("2026-11-21");
    expect(parseDateQuery("thurs", TODAY)).toBe("2026-11-26");
  });
  it("last weekday = strictly before today", () => {
    expect(parseDateQuery("last friday", TODAY)).toBe("2026-11-20");
    expect(parseDateQuery("last monday", TODAY)).toBe("2026-11-23");
    expect(parseDateQuery("last monday", "2026-11-23")).toBe("2026-11-16");
  });
  it("month-day without a year resolves to the most recent past occurrence", () => {
    expect(parseDateQuery("nov 2", TODAY)).toBe("2026-11-02");
    expect(parseDateQuery("November 2", TODAY)).toBe("2026-11-02");
    expect(parseDateQuery("2 nov", TODAY)).toBe("2026-11-02");
    expect(parseDateQuery("dec 25", TODAY)).toBe("2025-12-25");
    expect(parseDateQuery("nov 27", TODAY)).toBe(TODAY);
    expect(parseDateQuery("nov 28", TODAY)).toBe("2025-11-28");
  });
  it("Feb 29 with no year walks back to the last leap year", () => {
    expect(parseDateQuery("feb 29", TODAY)).toBe("2024-02-29");
  });
  it("explicit year", () => {
    expect(parseDateQuery("nov 2 2025", TODAY)).toBe("2025-11-02");
    expect(parseDateQuery("nov 2, 2025", TODAY)).toBe("2025-11-02");
    expect(parseDateQuery("feb 30 2024", TODAY)).toBeNull();
    expect(parseDateQuery("nov 2 25", TODAY)).toBeNull();
  });
  it("rejects non-dates so page searches don't produce date rows", () => {
    for (const q of ["", "sleep", "set", "s", "mo", "last", "last 7 days", "show 30", "nov", "next monday"]) {
      expect(parseDateQuery(q, TODAY)).toBeNull();
    }
  });
  it("returns null when today itself is invalid", () => {
    expect(parseDateQuery("today", "not-a-date")).toBeNull();
  });
});

describe("rangeCovering", () => {
  it("picks the smallest inclusive window containing the date", () => {
    expect(rangeCovering(TODAY, TODAY)).toBe("7d");
    expect(rangeCovering(shiftIso(TODAY, -6), TODAY)).toBe("7d");
    expect(rangeCovering(shiftIso(TODAY, -7), TODAY)).toBe("14d");
    expect(rangeCovering(shiftIso(TODAY, -13), TODAY)).toBe("14d");
    expect(rangeCovering(shiftIso(TODAY, -14), TODAY)).toBe("30d");
    expect(rangeCovering(shiftIso(TODAY, -29), TODAY)).toBe("30d");
    expect(rangeCovering(shiftIso(TODAY, -30), TODAY)).toBe("90d");
    expect(rangeCovering(shiftIso(TODAY, -89), TODAY)).toBe("90d");
    expect(rangeCovering(shiftIso(TODAY, -90), TODAY)).toBe("all");
  });
  it("returns null for the future", () => {
    expect(rangeCovering("2026-11-28", TODAY)).toBeNull();
  });
});

describe("dateItems", () => {
  it("offers each range-aware dashboard page with the covering range", () => {
    const items = dateItems("2026-11-02", TODAY);
    expect(items.map((i) => i.href)).toEqual([
      "/?range=30d",
      "/recovery?range=30d",
      "/sleep?range=30d",
      "/strain?range=30d",
      "/workouts?range=30d",
    ]);
    expect(items[0].label).toBe("Overview around Mon, Nov 2");
    expect(items.every((i) => i.group === "Date")).toBe(true);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
  it("is empty for future dates and non-dates", () => {
    expect(dateItems("2026-12-01", TODAY)).toEqual([]);
    expect(dateItems("sleep", TODAY)).toEqual([]);
  });
  it("shows the year when it differs", () => {
    expect(formatDateLabel("2025-12-25", TODAY)).toBe("Thu, Dec 25, 2025");
    expect(formatDateLabel("2026-11-02", TODAY)).toBe("Mon, Nov 2");
  });
});

describe("baseItems", () => {
  it("lists every nav destination once, plus actions", () => {
    const items = baseItems(ctx);
    const pages = items.filter((i) => i.group === "Jump to");
    expect(pages.map((p) => p.label)).toEqual(DESTINATIONS.map((d) => d.label));
    expect(items.find((i) => i.id === "action:today")?.href).toBe("/?range=7d");
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });
  it("preserves a valid current range on range-aware pages only", () => {
    const items = baseItems({ pathname: "/sleep", range: "90d" });
    expect(items.find((i) => i.id === "page:/recovery")?.href).toBe("/recovery?range=90d");
    expect(items.find((i) => i.id === "page:/coach")?.href).toBe("/coach");
    expect(items.find((i) => i.id === "page:/sleep")?.hint).toBe("Current page");
  });
  it("ignores a bogus range param", () => {
    const items = baseItems({ pathname: "/", range: "999d" });
    expect(items.find((i) => i.id === "page:/sleep")?.href).toBe("/sleep");
  });
  it("range actions target the current page, or Overview off range pages", () => {
    const onSleep = baseItems({ pathname: "/sleep", range: null });
    expect(onSleep.find((i) => i.id === "action:range:14d")?.href).toBe("/sleep?range=14d");
    const onCoach = baseItems({ pathname: "/coach", range: null });
    expect(onCoach.find((i) => i.id === "action:range:14d")?.href).toBe("/?range=14d");
  });
});

describe("paletteResults", () => {
  it("puts date jumps first, then fuzzy matches", () => {
    const r = paletteResults("yesterday", ctx, TODAY);
    expect(r[0].group).toBe("Date");
    expect(r[0].href).toBe("/?range=7d");
  });
  it("caps the list", () => {
    expect(paletteResults("", ctx, TODAY).length).toBeLessThanOrEqual(MAX_RESULTS);
  });
  it("still works with no today (date rows simply absent)", () => {
    const r = paletteResults("today", ctx, "");
    expect(r.every((i) => i.group !== "Date")).toBe(true);
    expect(r[0].label).toBe("Go to today");
  });
});

describe("localIsoDate", () => {
  it("uses local calendar fields, not UTC", () => {
    const d = new Date(2026, 10, 27, 23, 30); // local 11:30pm
    expect(localIsoDate(d)).toBe("2026-11-27");
  });
});
