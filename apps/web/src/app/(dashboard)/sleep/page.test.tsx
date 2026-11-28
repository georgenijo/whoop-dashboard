// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
}));

const db = vi.hoisted(() => ({
  getOverviewSnapshot: vi.fn(() => ({ latestSleep: null })),
  getRecoveryRange: vi.fn(() => []),
  getSleepRange: vi.fn(() => []),
  getNaps: vi.fn(() => []),
  getStrainRange: vi.fn(() => []),
}));
vi.mock("@/lib/db", () => db);

import SleepPage from "./page";
import TonightSleepPlanCard from "@/components/charts/TonightSleepPlanCard";

function findByType(node: ReactNode, type: unknown): ReactElement[] {
  const out: ReactElement[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement(n)) return;
    if (n.type === type) out.push(n);
    walk((n.props as { children?: ReactNode }).children);
  };
  walk(node);
  return out;
}

describe("/sleep SLEEP_PLAN flag", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 20, 20, 0));
    Object.values(db).forEach((fn) => fn.mockClear());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("flag off: no card and no extra reads", async () => {
    vi.stubEnv("SLEEP_PLAN", "");
    const tree = await SleepPage({ searchParams: Promise.resolve({}) });
    expect(findByType(tree, TonightSleepPlanCard)).toHaveLength(0);
    expect(db.getSleepRange).toHaveBeenCalledTimes(1);
    expect(db.getRecoveryRange).toHaveBeenCalledTimes(1);
  });

  it("flag on: renders the card from a fixed 30-day user-scoped read", async () => {
    vi.stubEnv("SLEEP_PLAN", "1");
    const tree = await SleepPage({ searchParams: Promise.resolve({ range: "7d" }) });
    const cards = findByType(tree, TonightSleepPlanCard);
    expect(cards).toHaveLength(1);
    expect((cards[0].props as { plan: { status: string } }).plan.status).toBe("insufficient");
    expect(db.getSleepRange).toHaveBeenCalledTimes(2);
    expect(db.getSleepRange).toHaveBeenLastCalledWith(7, "2026-10-22", "2026-11-20");
    expect(db.getRecoveryRange).toHaveBeenLastCalledWith(7, "2026-10-22", "2026-11-20");
  });
});

function regularityLinks(tree: ReactNode): ReactElement[] {
  const out: ReactElement[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement(n)) return;
    if ((n.props as { href?: string }).href === "/sleep/regularity") out.push(n);
    walk((n.props as { children?: ReactNode }).children);
  };
  walk(tree);
  return out;
}

describe("/sleep SLEEP_REGULARITY link", () => {
  beforeEach(() => {
    Object.values(db).forEach((fn) => fn.mockClear());
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "", "0", "true"])("flag %s: no link and no extra reads", async (v) => {
    vi.stubEnv("SLEEP_REGULARITY", v as string);
    const tree = await SleepPage({ searchParams: Promise.resolve({}) });
    expect(regularityLinks(tree)).toHaveLength(0);
    expect(db.getSleepRange).toHaveBeenCalledTimes(1);
  });

  it("flag on: links to /sleep/regularity without any extra reads", async () => {
    vi.stubEnv("SLEEP_REGULARITY", "1");
    const tree = await SleepPage({ searchParams: Promise.resolve({}) });
    expect(regularityLinks(tree)).toHaveLength(1);
    expect(db.getSleepRange).toHaveBeenCalledTimes(1);
  });
});

function stagesLinks(tree: ReactNode): ReactElement[] {
  const out: ReactElement[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement(n)) return;
    if ((n.props as { href?: string }).href === "/sleep/stages") out.push(n);
    walk((n.props as { children?: ReactNode }).children);
  };
  walk(tree);
  return out;
}

describe("/sleep SLEEP_STAGES link", () => {
  beforeEach(() => {
    Object.values(db).forEach((fn) => fn.mockClear());
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, "", "0", "true"])("flag %s: no link and no extra reads", async (v) => {
    vi.stubEnv("SLEEP_STAGES", v as string);
    const tree = await SleepPage({ searchParams: Promise.resolve({}) });
    expect(stagesLinks(tree)).toHaveLength(0);
    expect(db.getSleepRange).toHaveBeenCalledTimes(1);
  });

  it("flag on: links to /sleep/stages without any extra reads", async () => {
    vi.stubEnv("SLEEP_STAGES", "1");
    const tree = await SleepPage({ searchParams: Promise.resolve({}) });
    expect(stagesLinks(tree)).toHaveLength(1);
    expect(db.getSleepRange).toHaveBeenCalledTimes(1);
  });
});
