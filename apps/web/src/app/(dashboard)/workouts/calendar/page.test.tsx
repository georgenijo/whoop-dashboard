// @vitest-environment node
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const m = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
  getWorkoutRowsRange: vi.fn(),
  getUserSettings: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  notFound: m.notFound,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/auth", () => ({ requireAuthOrSignin: m.requireAuthOrSignin }));
vi.mock("@/lib/db", () => ({
  getWorkoutRowsRange: m.getWorkoutRowsRange,
  getUserSettings: m.getUserSettings,
}));

import WorkoutCalendarPage from "./page";

const row = (id: string, start_utc: string, over: Record<string, unknown> = {}) => ({
  id,
  date: start_utc.slice(0, 10),
  sport: "Running",
  duration_sec: 3600,
  strain: 12.3,
  start_utc,
  ...over,
});

const call = (month?: string | string[]) =>
  WorkoutCalendarPage({ searchParams: Promise.resolve({ month }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.getWorkoutRowsRange.mockReturnValue([]);
  m.getUserSettings.mockReturnValue({ tz: "America/New_York" });
  vi.useFakeTimers();
  // 03:30 UTC Nov 28 is still Nov 27 in New York.
  vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("/workouts/calendar page", () => {
  it.each([undefined, "", "0", "true", "yes"])(
    "404s with WORKOUT_CALENDAR=%s before auth or any DB read",
    async (v) => {
      vi.stubEnv("WORKOUT_CALENDAR", v as string);
      await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(m.requireAuthOrSignin).not.toHaveBeenCalled();
      expect(m.getWorkoutRowsRange).not.toHaveBeenCalled();
      expect(m.getUserSettings).not.toHaveBeenCalled();
    },
  );

  it("flag on: one bounded user-scoped read for the user's current month", async () => {
    vi.stubEnv("WORKOUT_CALENDAR", "1");
    m.getWorkoutRowsRange.mockReturnValue([
      row("w1", "2026-11-03T12:00:00Z", { sport: "Cycling", strain: 15.1 }),
      row("w2", "2026-11-05T11:00:00Z"),
      row("w3", "2026-11-05T22:00:00Z", { sport: "Weightlifting", duration_sec: 1800, strain: 7 }),
    ]);
    const html = renderToString(await call());
    expect(m.getWorkoutRowsRange).toHaveBeenCalledTimes(1);
    expect(m.getWorkoutRowsRange).toHaveBeenCalledWith(7, "2026-10-25", "2026-12-07");
    expect(m.getUserSettings).toHaveBeenCalledWith(7);
    expect(html).toContain("November 2026");
    expect(html).toContain('role="grid"');
    expect((html.match(/role="gridcell"/g) ?? []).length).toBe(42);
    expect((html.match(/role="columnheader"/g) ?? []).length).toBe(7);
    // Single-workout day links straight to the workout.
    expect(html).toContain('href="/workouts/w1"');
    // Multi-workout day is a button that opens the panel.
    expect(html).toMatch(/<button[^>]*aria-label="Thu, Nov 5: 2 workouts, 90 min \(Running, Weightlifting\), peak strain 12.3 \(moderate\)"/);
    // Today (Nov 27, user's zone) is marked; Nov 28 onwards is upcoming.
    expect(html).toContain('aria-current="date"');
    expect(html).toContain("Sat, Nov 28: upcoming");
    expect(html).toContain('data-testid="wcal-summary"');
    expect(html).toMatch(/data-testid="wcal-sessions".*?>3</);
    expect(html).toContain("Peak session strain");
    // Current month: no Next link, Prev points to October.
    expect(html).toContain('href="/workouts/calendar?month=2026-10"');
    expect(html).not.toContain('data-testid="wcal-next"');
  });

  it("?month= picks a valid past month and its grid", async () => {
    vi.stubEnv("WORKOUT_CALENDAR", "1");
    const html = renderToString(await call("2026-03"));
    expect(m.getWorkoutRowsRange).toHaveBeenCalledWith(7, "2026-02-22", "2026-04-06");
    expect(html).toContain("March 2026");
    expect(html).toContain('data-testid="wcal-empty"');
    expect(html).toContain('href="/workouts/calendar?month=2026-04"');
  });

  it.each(["2026-12", "2099-01", "2026-13", "garbage", "2011-12"])(
    "invalid or future ?month=%s falls back to the current month",
    async (raw) => {
      vi.stubEnv("WORKOUT_CALENDAR", "1");
      const html = renderToString(await call(raw));
      expect(m.getWorkoutRowsRange).toHaveBeenCalledWith(7, "2026-10-25", "2026-12-07");
      expect(html).toContain("November 2026");
    },
  );

  it("falls back to UTC on a missing tz", async () => {
    vi.stubEnv("WORKOUT_CALENDAR", "1");
    m.getUserSettings.mockReturnValue(null);
    const html = renderToString(await call());
    // In UTC it is already Nov 28.
    expect(html).toMatch(/aria-current="date"[^>]*>\s*<span[^>]*data-date="2026-11-28"/);
  });
});
