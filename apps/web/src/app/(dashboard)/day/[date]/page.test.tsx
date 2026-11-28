// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const m = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((to: string): never => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
  getUserSettings: vi.fn(() => ({ tz: "America/New_York" }) as { tz: string } | null),
  loadDayDetail: vi.fn((_u: number, date: string, today: string) => ({ date, today })),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: m.notFound, redirect: m.redirect }));
vi.mock("@/lib/auth", () => ({ requireAuthOrSignin: m.requireAuthOrSignin }));
vi.mock("@/lib/db", () => ({ getUserSettings: m.getUserSettings }));
vi.mock("@/lib/day-detail", () => ({ loadDayDetail: m.loadDayDetail }));

import DayDetailPage from "./page";
import DayIndexPage from "../page";

const call = (date: string) => DayDetailPage({ params: Promise.resolve({ date }) });
const callIndex = (date?: string | string[]) => DayIndexPage({ searchParams: Promise.resolve({ date }) });

beforeEach(() => {
  vi.useFakeTimers();
  // 03:30Z Nov 28 = 22:30 Nov 27 in New York.
  vi.setSystemTime(new Date("2026-11-28T03:30:00Z"));
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.DAY_DETAIL;
});

describe("/day/[date] — flag off", () => {
  it.each([undefined, "0", "true", ""])("DAY_DETAIL=%j → 404 before auth or any DB read", async (v) => {
    if (v !== undefined) process.env.DAY_DETAIL = v;
    await expect(call("2026-11-20")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(callIndex("2026-11-20")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(m.requireAuthOrSignin).not.toHaveBeenCalled();
    expect(m.getUserSettings).not.toHaveBeenCalled();
    expect(m.loadDayDetail).not.toHaveBeenCalled();
  });
});

describe("/day/[date] — flag on", () => {
  beforeEach(() => {
    process.env.DAY_DETAIL = "1";
  });

  it.each(["2026-02-30", "nope", "2026-1-01", "2026-11-20x"])("invalid %j → 404 before auth", async (d) => {
    await expect(call(d)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(m.requireAuthOrSignin).not.toHaveBeenCalled();
    expect(m.loadDayDetail).not.toHaveBeenCalled();
  });

  it("future date in the user's tz → 404 without reading day data", async () => {
    // Nov 28 is already today in UTC but still tomorrow in New York.
    await expect(call("2026-11-28")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(m.requireAuthOrSignin).toHaveBeenCalledTimes(1);
    expect(m.loadDayDetail).not.toHaveBeenCalled();
  });

  it("today in the user's tz renders, scoped to the signed-in user", async () => {
    const el = await call("2026-11-27");
    expect(m.loadDayDetail).toHaveBeenCalledWith(7, "2026-11-27", "2026-11-27", "America/New_York");
    expect(m.getUserSettings).toHaveBeenCalledWith(7);
    expect((el as { props: { day: unknown } }).props.day).toEqual({ date: "2026-11-27", today: "2026-11-27" });
  });

  it("no tz on file falls back to UTC, where Nov 28 is today", async () => {
    m.getUserSettings.mockReturnValueOnce(null);
    await call("2026-11-28");
    expect(m.loadDayDetail).toHaveBeenCalledWith(7, "2026-11-28", "2026-11-28", "UTC");
  });

  it("/day?date= redirects valid dates and falls back to today otherwise", async () => {
    await expect(callIndex("2026-11-01")).rejects.toThrow("NEXT_REDIRECT:/day/2026-11-01");
    await expect(callIndex(["2026-10-01", "2026-09-01"])).rejects.toThrow("NEXT_REDIRECT:/day/2026-10-01");
    await expect(callIndex(undefined)).rejects.toThrow("NEXT_REDIRECT:/day/2026-11-27");
    await expect(callIndex("2026-11-28")).rejects.toThrow("NEXT_REDIRECT:/day/2026-11-27");
    await expect(callIndex("garbage")).rejects.toThrow("NEXT_REDIRECT:/day/2026-11-27");
    expect(m.loadDayDetail).not.toHaveBeenCalled();
  });
});
