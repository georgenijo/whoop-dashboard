import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { parseDate, toLocalIso } from "./upsert";

describe("parseDate", () => {
  it("returns YYYY-MM-DD for a Z-suffixed UTC ISO string", () => {
    expect(parseDate("2025-04-12T08:30:00.000Z")).toBe("2025-04-12");
  });

  it("normalizes through UTC for an offset string", () => {
    // Same instant as 2025-04-12T08:30Z.
    expect(parseDate("2025-04-12T04:30:00-04:00")).toBe("2025-04-12");
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
