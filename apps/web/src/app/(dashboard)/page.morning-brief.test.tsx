// @vitest-environment node
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { readInputs } = vi.hoisted(() => ({
  readInputs: vi.fn(() => ({ today: "2026-11-27", recovery: [], sleep: [], cycles: [], workouts: [] })),
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
}));
vi.mock("@/lib/db", () => ({
  getDailySummaryForDates: vi.fn(() => []),
  getOverviewSnapshot: vi.fn(() => ({
    latestRecovery: null,
    previousRecovery: null,
    latestCycle: null,
    previousCycle: null,
    latestSleep: null,
    previousSleep: null,
    latestSteps: null,
    previousSteps: null,
  })),
  getPRStats: vi.fn(),
  getRecoveryRange: vi.fn(),
  getUserSettings: vi.fn(() => ({ onboarded_at: "2026-01-01", tz: "America/New_York", timezone: null })),
}));
vi.mock("@/lib/db/integrations", () => ({
  getIntegrationStatus: vi.fn(() => ({ exists: true, needs_reauth: false })),
}));
vi.mock("@/lib/db/morning-brief", () => ({ readOverviewMorningBriefInputs: readInputs }));
vi.mock("@/lib/insights", () => ({ scheduleInsightRegeneration: vi.fn() }));

import OverviewPage from "./page";

function findByName(node: ReactNode, name: string): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findByName(child, name);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  const type = node.type as { name?: string };
  if (typeof node.type === "function" && type.name === name) return node;
  return findByName((node.props as { children?: ReactNode }).children, name);
}

describe("Overview MORNING_BRIEF flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    readInputs.mockClear();
  });

  it("flag unset: no brief section and no extra reads", async () => {
    vi.stubEnv("MORNING_BRIEF", "");
    const tree = await OverviewPage({ searchParams: Promise.resolve({}) });
    expect(findByName(tree, "MorningBriefSection")).toBeNull();
    expect(readInputs).not.toHaveBeenCalled();
  });

  it("flag on: renders the section, which reads with the user's zones", async () => {
    vi.stubEnv("MORNING_BRIEF", "1");
    const tree = await OverviewPage({ searchParams: Promise.resolve({}) });
    const section = findByName(tree, "MorningBriefSection");
    expect(section).not.toBeNull();
    const Section = section!.type as (p: unknown) => Promise<ReactElement>;
    const card = await Section(section!.props);
    expect(readInputs).toHaveBeenCalledWith(7, ["America/New_York", null]);
    expect((card.type as { name?: string }).name).toBe("MorningBriefCard");
  });
});
