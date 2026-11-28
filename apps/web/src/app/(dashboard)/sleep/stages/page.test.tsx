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

import SleepStagesPage from "./page";

const MIN = 60_000;
function stageRows(end: string, n: number, opts: { deep?: (i: number) => number; noStage?: number[] } = {}) {
  const endMs = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: n }, (_, k) => {
    const i = n - 1 - k; // age in days
    const date = new Date(endMs - i * 86_400_000).toISOString().slice(0, 10);
    const missing = opts.noStage?.includes(i);
    return {
      date,
      light_ms: missing ? null : 240 * MIN,
      deep_ms: missing ? null : (opts.deep ? opts.deep(i) : 70) * MIN,
      rem_ms: missing ? null : 100 * MIN,
      awake_ms: missing ? null : 30 * MIN,
    };
  });
}

const call = (days?: string) => SleepStagesPage({ searchParams: Promise.resolve({ days }) });

beforeEach(() => {
  vi.clearAllMocks();
  m.getSleepRange.mockReturnValue([]);
  m.getUserSettings.mockReturnValue({ tz: "America/New_York" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("/sleep/stages page", () => {
  it.each([undefined, "", "0", "true", "yes"])(
    "404s with SLEEP_STAGES=%s before auth or any DB read",
    async (v) => {
      vi.stubEnv("SLEEP_STAGES", v as string);
      await expect(call()).rejects.toThrow("NEXT_NOT_FOUND");
      expect(m.requireAuthOrSignin).not.toHaveBeenCalled();
      expect(m.getSleepRange).not.toHaveBeenCalled();
      expect(m.getUserSettings).not.toHaveBeenCalled();
    },
  );

  it("flag on: one user-scoped 365-day read dated in the user's zone; renders all sections", async () => {
    vi.stubEnv("SLEEP_STAGES", "1");
    vi.useFakeTimers();
    // 03:30 UTC Nov 28 is still Nov 27 in New York.
    vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
    m.getSleepRange.mockReturnValue(stageRows("2026-11-27", 90, { deep: (i) => (i === 0 ? 30 : 70 + (i % 7)), noStage: [3] }));
    const html = renderToString(await call());
    expect(m.getSleepRange).toHaveBeenCalledTimes(1);
    expect(m.getSleepRange).toHaveBeenCalledWith(7, "2025-11-28", "2026-11-27");
    expect(m.getUserSettings).toHaveBeenCalledWith(7);
    expect(html).toContain("Sleep Stages");
    expect(html).toContain("Last 30 days");
    expect((html.match(/data-night=/g) ?? []).length).toBe(29);
    expect(html).toContain("1 with no stage data");
    expect(html).toContain('data-testid="stages-table"');
    expect((html.match(/data-stage-row=/g) ?? []).length).toBe(4);
    expect(html).toContain('data-position="below"'); // deep
    expect(html).toContain('data-position="within"'); // REM
    expect(html).toContain("Deep trend");
    expect(html).toContain("REM trend");
    expect(html).toContain('data-testid="stages-takeaway"');
    expect(html).toContain("was below your typical");
  });

  it.each([["14", 14, "2025-11-28"], ["90", 90, "2025-11-28"]] as const)(
    "?days=%s narrows the chart (read stays the same history)",
    async (raw, n, from) => {
      vi.stubEnv("SLEEP_STAGES", "1");
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
      m.getSleepRange.mockReturnValue(stageRows("2026-11-27", 120));
      const html = renderToString(await call(raw));
      expect(m.getSleepRange).toHaveBeenCalledWith(7, from, "2026-11-27");
      expect(html).toContain(`Last ${n} days`);
      expect((html.match(/data-night=/g) ?? []).length).toBe(n);
    },
  );

  it("an unknown ?days falls back to 30", async () => {
    vi.stubEnv("SLEEP_STAGES", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
    m.getSleepRange.mockReturnValue(stageRows("2026-11-27", 40));
    const html = renderToString(await call("365"));
    expect(html).toContain("Last 30 days");
  });

  it("fewer than 7 stage nights renders not-enough-data with the no-stage count", async () => {
    vi.stubEnv("SLEEP_STAGES", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-27T15:00:00Z"));
    m.getSleepRange.mockReturnValue(stageRows("2026-11-27", 8, { noStage: [0, 1, 2] }));
    const html = renderToString(await call());
    expect(html).toContain("Not enough data yet");
    expect(html).toContain("5 so far");
    expect(html).toContain("3 recorded with no stage data");
    expect(html).not.toContain("stages-chart");
  });

  it("empty data renders the not-enough-data state", async () => {
    vi.stubEnv("SLEEP_STAGES", "1");
    const html = renderToString(await call());
    expect(html).toContain("Not enough data yet");
  });

  it("falls back to UTC on a bad tz", async () => {
    vi.stubEnv("SLEEP_STAGES", "1");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
    m.getUserSettings.mockReturnValue({ tz: "Not/AZone" });
    await call();
    expect(m.getSleepRange).toHaveBeenCalledWith(7, "2025-11-29", "2026-11-28");
  });
});
