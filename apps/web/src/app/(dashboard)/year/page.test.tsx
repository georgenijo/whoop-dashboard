// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/lib/auth", () => ({
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
}));
vi.mock("@/lib/db", () => ({
  getRecoveryRange: vi.fn(() => []),
  getSleepRange: vi.fn(() => []),
  getStrainRange: vi.fn(() => []),
  getWorkoutRowsRange: vi.fn(() => []),
  getUserSettings: vi.fn(() => ({ tz: "America/New_York" })),
}));

import * as db from "@/lib/db";
import YearReviewPage from "./page";

const mocked = vi.mocked(db);

async function render(y?: string) {
  const el = await YearReviewPage({ searchParams: Promise.resolve(y == null ? {} : { y }) });
  return renderToStaticMarkup(el);
}

const rec = (date: string, recovery_score: number, hrv = 60, rhr = 52) => ({
  date,
  recovery_score,
  hrv,
  rhr,
  spo2: null,
  skin_temp: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  // 03:00 UTC on Jan 1 2026 is still Dec 31 2025 in New York: "current year"
  // must follow the user's timezone, not the server's UTC clock.
  vi.setSystemTime(new Date("2026-01-01T03:00:00Z"));
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("/year flag off", () => {
  it("404s before any data read", async () => {
    vi.stubEnv("YEAR_REVIEW", "");
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocked.getRecoveryRange).not.toHaveBeenCalled();
    expect(mocked.getSleepRange).not.toHaveBeenCalled();
    expect(mocked.getStrainRange).not.toHaveBeenCalled();
    expect(mocked.getWorkoutRowsRange).not.toHaveBeenCalled();
    expect(mocked.getUserSettings).not.toHaveBeenCalled();
  });

  it("treats values other than 1 as off", async () => {
    vi.stubEnv("YEAR_REVIEW", "true");
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("/year flag on", () => {
  beforeEach(() => vi.stubEnv("YEAR_REVIEW", "1"));

  it("defaults to the user's local current year, bounded to today", async () => {
    const html = await render();
    expect(html).toContain(">2025</h1>");
    for (const fn of [mocked.getRecoveryRange, mocked.getSleepRange, mocked.getStrainRange, mocked.getWorkoutRowsRange]) {
      expect(fn).toHaveBeenCalledWith(7, "2025-01-01", "2025-12-31");
    }
    // No "next year" link past the current year.
    expect(html).not.toContain("/year?y=2026");
    expect(html).toContain('href="/year?y=2024"');
  });

  it("reads exactly one calendar year for a valid ?y=", async () => {
    await render("2024");
    expect(mocked.getRecoveryRange).toHaveBeenCalledWith(7, "2024-01-01", "2024-12-31");
  });

  it.each(["2026", "1999", "abc", "2025-01"])("falls back to the current year for ?y=%s", async (y) => {
    const html = await render(y);
    expect(html).toContain(">2025</h1>");
    expect(mocked.getRecoveryRange).toHaveBeenCalledWith(7, "2025-01-01", "2025-12-31");
  });

  it("renders a friendly empty state for a year with no data", async () => {
    const html = await render("2019");
    expect(html).toContain("Nothing recorded in 2019");
    expect(html).not.toContain("Month by month");
  });

  it("renders the review sections from scoped rows", async () => {
    mocked.getRecoveryRange.mockReturnValue(
      Array.from({ length: 10 }, (_, i) => rec(`2025-03-${String(i + 1).padStart(2, "0")}`, 80, 60 + i, 50 + i)),
    );
    mocked.getStrainRange.mockReturnValue([{ date: "2025-03-04", strain: 17.26, kilojoule: null, avg_hr: null, max_hr: null }]);
    mocked.getWorkoutRowsRange.mockReturnValue([
      {
        id: "w1",
        date: "2025-03-04",
        sport: "Running",
        duration_sec: 3600,
        avg_hr: null,
        max_hr: null,
        strain: null,
        kilojoule: null,
        distance_m: null,
        zone_0_ms: null,
        zone_1_ms: null,
        zone_2_ms: 1_800_000,
        zone_3_ms: null,
        zone_4_ms: null,
        zone_5_ms: null,
        start_utc: null,
        end_utc: null,
      },
    ]);

    const html = await render("2025");
    expect(html).toContain("Highlights");
    expect(html).toContain("March was your strongest month, averaging 80% recovery.");
    expect(html).toContain("Your longest green run was 10 days in a row (Mar 1 – Mar 10).");
    expect(html).toContain("Month by month");
    expect(html).toContain("Running");
    expect(html).toContain("69 ms"); // highest HRV
    expect(html).toContain("50 bpm"); // lowest RHR
    expect(html).toContain("17.3"); // highest strain day
    // 12 month rows for a full past year.
    expect(html.match(/Dec<\/span>/g)?.length).toBe(1);
  });
});
