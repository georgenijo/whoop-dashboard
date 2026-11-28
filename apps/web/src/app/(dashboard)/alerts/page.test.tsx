// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
  getRecoveryRange: vi.fn(() => []),
  getSleepRange: vi.fn(() => []),
  getStrainRange: vi.fn(() => []),
  getLastSuccessfulSyncAt: vi.fn(() => null),
  getInsightToday: vi.fn(() => "2026-11-27"),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/auth", () => ({ requireAuthOrSignin: mocks.requireAuthOrSignin }));
vi.mock("@/lib/db", () => ({
  getRecoveryRange: mocks.getRecoveryRange,
  getSleepRange: mocks.getSleepRange,
  getStrainRange: mocks.getStrainRange,
  getLastSuccessfulSyncAt: mocks.getLastSuccessfulSyncAt,
}));
vi.mock("@/lib/db/summary", () => ({ getInsightToday: mocks.getInsightToday }));

import AlertsPage from "./page";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("/alerts page", () => {
  it.each([undefined, "", "0", "true", "yes"])("404s with HEALTH_ALERTS=%s and reads nothing", async (v) => {
    vi.stubEnv("HEALTH_ALERTS", v as string);
    await expect(AlertsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.requireAuthOrSignin).not.toHaveBeenCalled();
    expect(mocks.getRecoveryRange).not.toHaveBeenCalled();
    expect(mocks.getInsightToday).not.toHaveBeenCalled();
  });

  it("with HEALTH_ALERTS=1 reads the signed-in user's last 60 days only", async () => {
    vi.stubEnv("HEALTH_ALERTS", "1");
    const el = await AlertsPage();
    expect(el).toBeTruthy();
    expect(mocks.getInsightToday).toHaveBeenCalledWith(7);
    for (const fn of [mocks.getRecoveryRange, mocks.getSleepRange, mocks.getStrainRange]) {
      expect(fn).toHaveBeenCalledWith(7, "2026-09-28", "2026-11-27");
    }
    expect(mocks.getLastSuccessfulSyncAt).toHaveBeenCalledWith(7);
    const result = (el as { props: { result: { alerts: { kind: string }[] } } }).props.result;
    expect(result.alerts.map((a) => a.kind)).toEqual(["freshness"]);
  });
});
