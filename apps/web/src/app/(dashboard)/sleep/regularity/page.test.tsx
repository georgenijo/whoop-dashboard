// @vitest-environment node
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const m = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
  getSleepRange: vi.fn(),
  getUserSettings: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: m.notFound }));
vi.mock("@/lib/auth", () => ({ requireAuthOrSignin: m.requireAuthOrSignin }));
vi.mock("@/lib/db", () => ({
  getSleepRange: m.getSleepRange,
  getUserSettings: m.getUserSettings,
}));

import SleepRegularityPage from "./page";

function steadyNights(end: string, n: number) {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const wake = new Date(endMs - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10);
    const bed = new Date(endMs - (n - i) * 86_400_000).toISOString().slice(0, 10);
    return { date: wake, start_local: `${bed}T23:00:00`, end_local: `${wake}T07:00:00` };
  });
}

const call = (window?: string) => SleepRegularityPage({ searchParams: Promise.resolve({ window }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.getSleepRange.mockReturnValue([]);
  m.getUserSettings.mockReturnValue({ tz: "America/New_York" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("/sleep/regularity page", () => {
  it.each([undefined, "", "0", "true", "yes"])(
    "404s with SLEEP_REGULARITY=%s before auth or any DB read",
    async (v) => {
      vi.stubEnv("SLEEP_REGULARITY", v as string);
      await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(m.requireAuthOrSignin).not.toHaveBeenCalled();
      expect(m.getSleepRange).not.toHaveBeenCalled();
      expect(m.getUserSettings).not.toHaveBeenCalled();
    },
  );

  it("flag on: reads only the user's own 30-day window, dated in the user's zone", async () => {
    vi.stubEnv("SLEEP_REGULARITY", "1");
    vi.useFakeTimers();
    // 03:30 UTC Nov 28 is still Nov 27 in New York.
    vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
    m.getSleepRange.mockReturnValue(steadyNights("2026-11-27", 30));
    const html = renderToString(await call());
    expect(m.getSleepRange).toHaveBeenCalledTimes(1);
    expect(m.getSleepRange).toHaveBeenCalledWith(7, "2026-10-29", "2026-11-27");
    expect(m.getUserSettings).toHaveBeenCalledWith(7);
    expect(html).toContain("Sleep Regularity");
    expect(html).toContain("Very regular");
    expect(html).toContain(">100<"); // SRI
    expect(html).toContain("Bedtime consistency");
    expect(html).toContain("Wake-time consistency");
    expect(html).toContain("Social jetlag");
    expect(html).toContain('data-testid="regularity-tip"');
    expect((html.match(/data-night=/g) ?? []).length).toBe(30);
  });

  it("?window=14 narrows the read and the chart", async () => {
    vi.stubEnv("SLEEP_REGULARITY", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
    m.getSleepRange.mockReturnValue(steadyNights("2026-11-27", 14));
    const html = renderToString(await call("14"));
    expect(m.getSleepRange).toHaveBeenCalledWith(7, "2026-11-14", "2026-11-27");
    expect(html).toContain("Last 14 days");
    expect((html.match(/data-night=/g) ?? []).length).toBe(14);
  });

  it("an unknown window falls back to 30 days", async () => {
    vi.stubEnv("SLEEP_REGULARITY", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
    await call("999");
    expect(m.getSleepRange).toHaveBeenCalledWith(7, "2026-10-29", "2026-11-27");
  });

  it("fewer than 7 nights renders the not-enough-data state", async () => {
    vi.stubEnv("SLEEP_REGULARITY", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
    m.getSleepRange.mockReturnValue(steadyNights("2026-11-27", 3));
    const html = renderToString(await call());
    expect(html).toContain("Not enough data yet");
    expect(html).toContain("3 so far");
    expect(html).not.toContain("regularity-chart");
  });

  it("empty data renders the not-enough-data state", async () => {
    vi.stubEnv("SLEEP_REGULARITY", "1");
    const html = renderToString(await call());
    expect(html).toContain("Not enough data yet");
  });

  it("falls back to UTC on a bad tz", async () => {
    vi.stubEnv("SLEEP_REGULARITY", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
    m.getUserSettings.mockReturnValue({ tz: "Not/AZone" });
    await call();
    expect(m.getSleepRange).toHaveBeenCalledWith(7, "2026-10-30", "2026-11-28");
  });
});
