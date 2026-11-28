// @vitest-environment node
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const m = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
  getRecoveryRange: vi.fn(),
  getSleepRange: vi.fn(),
  getStrainRange: vi.fn(),
  getUserSettings: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: m.notFound }));
vi.mock("@/lib/auth", () => ({ requireAuthOrSignin: m.requireAuthOrSignin }));
vi.mock("@/lib/db", () => ({
  getRecoveryRange: m.getRecoveryRange,
  getSleepRange: m.getSleepRange,
  getStrainRange: m.getStrainRange,
  getUserSettings: m.getUserSettings,
}));

import BaselinesPage from "./page";

const H = 3_600_000;

function dates(end: string, n: number): string[] {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) =>
    new Date(endMs - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

function seedFull(end: string, n: number) {
  const ds = dates(end, n);
  m.getRecoveryRange.mockReturnValue(
    ds.map((d, i) => ({
      date: d,
      recovery_score: 40 + (i % 40),
      hrv: d === end ? 30 : 45 + (i % 10) + (i >= n - 30 ? 5 : 0),
      rhr: 52 + (i % 4),
      spo2: null,
      skin_temp: 33.4 + (i % 3) * 0.1,
    })),
  );
  m.getSleepRange.mockReturnValue(
    ds.map((d, i) => ({
      date: d,
      light_ms: 4 * H + (i % 5) * 0.1 * H,
      deep_ms: 1.5 * H,
      rem_ms: 1.5 * H,
      performance: 80 + (i % 15),
      respiratory_rate: 14.5 + (i % 4) * 0.1,
    })),
  );
  m.getStrainRange.mockReturnValue(ds.map((d, i) => ({ date: d, strain: 8 + (i % 8) })));
}

const call = (window?: string) => BaselinesPage({ searchParams: Promise.resolve({ window }) });
/** SSR output with React's text-node separators removed. */
const html = async (window?: string) => renderToString(await call(window)).replace(/<!-- -->/g, "");

beforeEach(() => {
  vi.clearAllMocks();
  m.getRecoveryRange.mockReturnValue([]);
  m.getSleepRange.mockReturnValue([]);
  m.getStrainRange.mockReturnValue([]);
  m.getUserSettings.mockReturnValue({ tz: "America/New_York" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("/baselines page", () => {
  it.each([undefined, "", "0", "true", "yes", " 1"])(
    "404s with BASELINES_PAGE=%s before auth or any DB read",
    async (v) => {
      vi.stubEnv("BASELINES_PAGE", v as string);
      await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(m.requireAuthOrSignin).not.toHaveBeenCalled();
      expect(m.getRecoveryRange).not.toHaveBeenCalled();
      expect(m.getSleepRange).not.toHaveBeenCalled();
      expect(m.getStrainRange).not.toHaveBeenCalled();
      expect(m.getUserSettings).not.toHaveBeenCalled();
    },
  );

  it("flag on: three user-scoped reads, dated in the user's zone", async () => {
    vi.stubEnv("BASELINES_PAGE", "1");
    vi.useFakeTimers();
    // 03:30 UTC Nov 28 is still Nov 27 in New York.
    vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
    seedFull("2026-11-27", 120);
    const out = await html();
    for (const fn of [m.getRecoveryRange, m.getSleepRange, m.getStrainRange]) {
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(7, "2026-08-29", "2026-11-27");
    }
    expect(m.getUserSettings).toHaveBeenCalledWith(7);
    expect(out).toContain("Your baselines");
    expect(out).toContain("over the last 30 days (Oct 29–Nov 27)");
    for (const key of ["hrv", "rhr", "respiratory_rate", "skin_temp", "sleep_hours", "sleep_performance", "recovery", "strain"]) {
      expect(out).toContain(`data-testid="baseline-${key}"`);
      expect(out).toContain(`data-testid="spark-${key}"`);
    }
    expect((out.match(/data-band="true"/g) ?? []).length).toBe(8);
    expect((out.match(/data-status="ready"/g) ?? []).length).toBe(8);
    // Today's HRV of 30 is far below the band.
    expect(out).toMatch(/data-testid="baseline-hrv" data-status="ready" data-position="below"/);
    expect(out).toContain("Below your normal");
    expect(out).toContain("25th–75th percentile");
    // HRV baseline is up vs 60 days ago.
    expect(out).toMatch(/data-testid="trend-hrv" data-trend="rising"/);
    // Skin temperature headline is a signed deviation.
    expect(out).toMatch(/data-testid="latest-skin_temp">[+−±]\d\.\d °C</);
    expect(out).not.toContain('data-testid="baselines-empty"');
  });

  it("?window=90 widens the read and the sample", async () => {
    vi.stubEnv("BASELINES_PAGE", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
    seedFull("2026-11-27", 200);
    const out = await html("90");
    expect(m.getRecoveryRange).toHaveBeenCalledWith(7, "2026-06-30", "2026-11-27");
    expect(out).toContain("median of 90 days");
    expect(out).toContain('aria-current="page" href="/baselines?window=90"');
  });

  it("an unknown window falls back to 30 days", async () => {
    vi.stubEnv("BASELINES_PAGE", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
    await call("999");
    expect(m.getRecoveryRange).toHaveBeenCalledWith(7, "2026-08-29", "2026-11-27");
  });

  it("empty data renders the building state for every metric", async () => {
    vi.stubEnv("BASELINES_PAGE", "1");
    const out = await html();
    expect(out).toContain('data-testid="baselines-empty"');
    expect((out.match(/data-status="building"/g) ?? []).length).toBe(8);
    expect(out).toContain("Building baseline");
    expect(out).not.toContain("data-band");
  });

  it("sparse data: a few days shows progress, not a baseline", async () => {
    vi.stubEnv("BASELINES_PAGE", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
    seedFull("2026-11-27", 5);
    const out = await html();
    expect(out).toContain("5 of 14 days so far");
    expect(out).toContain('data-testid="baselines-empty"');
  });

  it("falls back to UTC on a bad tz", async () => {
    vi.stubEnv("BASELINES_PAGE", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
    m.getUserSettings.mockReturnValue({ tz: "Not/AZone" });
    await call();
    expect(m.getRecoveryRange).toHaveBeenCalledWith(7, "2026-08-30", "2026-11-28");
  });
});
