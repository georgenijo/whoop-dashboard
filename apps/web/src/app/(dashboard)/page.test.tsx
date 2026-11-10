// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn((destination: string): never => {
    throw new Error(`NEXT_REDIRECT:${destination}`);
  }),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 1 }, source: "web" })),
}));
vi.mock("@/lib/db", () => ({
  getDailySummaryForDates: vi.fn(() => []),
  getOverviewSnapshot: vi.fn(),
  getPRStats: vi.fn(),
  getRecoveryRange: vi.fn(),
  getUserSettings: vi.fn(() => null),
}));
vi.mock("@/lib/db/integrations", () => ({ getIntegrationStatus: vi.fn() }));
vi.mock("@/lib/coach/api-key", () => ({ resolveApiKeyForUser: vi.fn() }));
vi.mock("@/lib/insights", () => ({
  acquireInsightRegenerationLock: vi.fn(),
  getInsightStatus: vi.fn(),
  regenerateInsight: vi.fn(),
}));

import OverviewPage from "./page";

describe("OverviewPage onboarding redirect", () => {
  it("redirects users without onboarding to /welcome", async () => {
    await expect(OverviewPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      "NEXT_REDIRECT:/welcome",
    );
    expect(redirect).toHaveBeenCalledWith("/welcome");
  });
});
