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
  loadTodayCard: vi.fn((_u: number, opts: object) => ({ stub: true, ...opts })),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: m.notFound, redirect: m.redirect }));
vi.mock("@/lib/auth", () => ({ requireAuthOrSignin: m.requireAuthOrSignin }));
vi.mock("@/lib/share/load", () => ({ loadTodayCard: m.loadTodayCard }));

import ShareTodayPage from "./page";

const call = (sp: Record<string, string | string[] | undefined> = {}) =>
  ShareTodayPage({ searchParams: Promise.resolve(sp) });

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  delete process.env.SHARE_CARD;
});

describe("/share/today — flag off", () => {
  it.each([undefined, "0", "true", ""])("SHARE_CARD=%j → 404 before auth or any DB read", async (v) => {
    if (v !== undefined) process.env.SHARE_CARD = v;
    await expect(call({ hide: "1" })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(m.requireAuthOrSignin).not.toHaveBeenCalled();
    expect(m.loadTodayCard).not.toHaveBeenCalled();
  });
});

describe("/share/today — flag on", () => {
  beforeEach(() => {
    process.env.SHARE_CARD = "1";
  });

  it("no session → the same /signin redirect as every other page, no data read", async () => {
    m.requireAuthOrSignin.mockImplementationOnce(async () => m.redirect("/signin"));
    await expect(call()).rejects.toThrow("NEXT_REDIRECT:/signin");
    expect(m.loadTodayCard).not.toHaveBeenCalled();
  });

  it("renders the signed-in user's own card with default options", async () => {
    const el = await call();
    expect(m.loadTodayCard).toHaveBeenCalledWith(7, { hideNumbers: false, theme: "dark" });
    expect((el as { props: { model: unknown } }).props.model).toEqual({ stub: true, hideNumbers: false, theme: "dark" });
  });

  it("passes hide-numbers and theme from the query", async () => {
    await call({ hide: "1", theme: "light" });
    expect(m.loadTodayCard).toHaveBeenCalledWith(7, { hideNumbers: true, theme: "light" });
  });

  it("ignores junk query values and any user id in the query", async () => {
    await call({ hide: "yes", theme: "neon", user: "2", user_id: "2" });
    expect(m.loadTodayCard).toHaveBeenCalledWith(7, { hideNumbers: false, theme: "dark" });
  });
});
