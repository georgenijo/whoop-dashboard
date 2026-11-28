// @vitest-environment node
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const m = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
  getStrainRange: vi.fn(),
  getUserSettings: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: m.notFound }));
vi.mock("@/lib/auth", () => ({ requireAuthOrSignin: m.requireAuthOrSignin }));
vi.mock("@/lib/db", () => ({
  getStrainRange: m.getStrainRange,
  getUserSettings: m.getUserSettings,
}));

import TrainingLoadPage from "./page";

function rowsEnding(end: string, n: number, strain: number) {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(endMs - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    strain,
    kilojoule: null,
    avg_hr: null,
    max_hr: null,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  m.getStrainRange.mockReturnValue([]);
  m.getUserSettings.mockReturnValue({ tz: "America/New_York" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("/load page", () => {
  it.each([undefined, "", "0", "true", "yes"])(
    "404s with TRAINING_LOAD=%s before auth or any DB read",
    async (v) => {
      vi.stubEnv("TRAINING_LOAD", v as string);
      await expect(TrainingLoadPage()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(m.requireAuthOrSignin).not.toHaveBeenCalled();
      expect(m.getStrainRange).not.toHaveBeenCalled();
      expect(m.getUserSettings).not.toHaveBeenCalled();
    },
  );

  it("with TRAINING_LOAD=1 reads only the user's own window, dated in the user's zone", async () => {
    vi.stubEnv("TRAINING_LOAD", "1");
    vi.useFakeTimers();
    // 03:30 UTC Nov 28 is still Nov 27 in New York.
    vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
    m.getStrainRange.mockReturnValue(rowsEnding("2026-11-27", 60, 10));
    const html = renderToString(await TrainingLoadPage());
    // 84 chart days + 27-day chronic lookback = 111 days ending today.
    expect(m.getStrainRange).toHaveBeenCalledWith(7, "2026-08-09", "2026-11-27");
    expect(m.getUserSettings).toHaveBeenCalledWith(7);
    expect(html).toContain("Training Load Balance");
    expect(html).toContain("1.00");
    expect(html).toContain("Sweet spot");
    expect(html).toContain("Nov 28"); // projection is for tomorrow
  });

  it("crosses the US DST change correctly (spring forward)", async () => {
    vi.stubEnv("TRAINING_LOAD", "1");
    vi.useFakeTimers();
    // US DST began 2026-03-08 02:00 local. 03:30 UTC Mar 9 is 23:30 EDT on
    // Mar 8 (it would be Mar 8 22:30 under EST; a naive UTC date says Mar 9).
    vi.setSystemTime(new Date("2026-03-09T03:30:00Z"));
    await TrainingLoadPage();
    expect(m.getStrainRange).toHaveBeenCalledWith(7, "2025-11-18", "2026-03-08");
  });

  it("falls back to UTC for a missing or invalid timezone", async () => {
    vi.stubEnv("TRAINING_LOAD", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
    m.getUserSettings.mockReturnValue({ tz: "Not/AZone" });
    await TrainingLoadPage();
    expect(m.getStrainRange).toHaveBeenLastCalledWith(7, "2026-08-10", "2026-11-28");
    m.getUserSettings.mockReturnValue(null);
    await TrainingLoadPage();
    expect(m.getStrainRange).toHaveBeenLastCalledWith(7, "2026-08-10", "2026-11-28");
  });

  it("renders the building-baseline state for a new user", async () => {
    vi.stubEnv("TRAINING_LOAD", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-28T15:00:00Z"));
    m.getStrainRange.mockReturnValue(rowsEnding("2026-11-28", 3, 9));
    const html = renderToString(await TrainingLoadPage());
    expect(html).toContain("Building baseline");
    expect(html).toContain("25 more days");
  });
});
