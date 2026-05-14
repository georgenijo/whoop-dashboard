import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseDate, toLocalIso } from "./upsert";

describe("parseDate", () => {
  it("returns YYYY-MM-DD for a Z-suffixed UTC ISO string under UTC tz", () => {
    expect(parseDate("2025-04-12T08:30:00.000Z", "UTC")).toBe("2025-04-12");
  });

  it("normalizes through UTC for an offset string under UTC tz", () => {
    // Same instant as 2025-04-12T08:30Z.
    expect(parseDate("2025-04-12T04:30:00-04:00", "UTC")).toBe("2025-04-12");
  });

  // Issue #345 regression: late-evening workout in EDT (UTC-4) at 21:52 local
  // = 01:52 UTC the NEXT day. Old UTC-slice behavior misfiled this as 05-14
  // instead of 05-13. New behavior honors America/New_York.
  it("files an EDT late-evening UTC instant under the user's local calendar day", () => {
    expect(parseDate("2026-05-14T01:52:37Z", "America/New_York")).toBe(
      "2026-05-13",
    );
  });

  it("preserves prior UTC behavior when tz='UTC' is passed explicitly", () => {
    expect(parseDate("2026-05-14T01:52:37Z", "UTC")).toBe("2026-05-14");
  });

  it("handles DST spring-forward (EST → EDT) correctly", () => {
    // 06:30 UTC on 2026-03-08 = 02:30 EDT (after spring-forward at 02:00 EST → 03:00 EDT).
    expect(parseDate("2026-03-08T06:30:00Z", "America/New_York")).toBe(
      "2026-03-08",
    );
  });

  it("handles DST fall-back (EDT → EST) correctly", () => {
    // 2026-11-01 02:00 EDT falls back to 01:00 EST. 05:30 UTC = 01:30 EDT; 06:30 UTC = 01:30 EST.
    expect(parseDate("2026-11-01T05:30:00Z", "America/New_York")).toBe(
      "2026-11-01",
    );
    expect(parseDate("2026-11-01T06:30:00Z", "America/New_York")).toBe(
      "2026-11-01",
    );
  });

  it("handles +14 offset wraparound (Pacific/Kiritimati)", () => {
    // 11:00 UTC on 2026-05-13 = 01:00 next-day local in UTC+14.
    expect(parseDate("2026-05-13T11:00:00Z", "Pacific/Kiritimati")).toBe(
      "2026-05-14",
    );
  });

  it("throws on an invalid IANA tz", () => {
    expect(() => parseDate("2026-05-14T01:52:37Z", "Not/A_Zone")).toThrow();
  });
});

describe("toLocalIso", () => {
  it("returns null when either arg is missing", () => {
    expect(toLocalIso(null, "+00:00")).toBeNull();
    expect(toLocalIso("2025-04-12T08:30:00.000Z", null)).toBeNull();
  });

  it("shifts a UTC ISO into a naive local ISO using a positive offset", () => {
    expect(toLocalIso("2025-04-12T08:30:00.000Z", "+02:30")).toBe(
      "2025-04-12T11:00:00",
    );
  });

  it("shifts a UTC ISO into a naive local ISO using a negative offset", () => {
    expect(toLocalIso("2025-04-12T08:30:00.000Z", "-04:00")).toBe(
      "2025-04-12T04:30:00",
    );
  });

  it("handles offsets that cross midnight", () => {
    expect(toLocalIso("2025-04-12T01:00:00.000Z", "-05:00")).toBe(
      "2025-04-11T20:00:00",
    );
  });

  it("returns null on malformed input", () => {
    expect(toLocalIso("not-an-iso", "+00:00")).toBeNull();
  });
});
