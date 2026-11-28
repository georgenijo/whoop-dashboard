// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
}));
vi.mock("@/lib/date", () => ({ localToday: () => "2026-11-27" }));

const db = vi.hoisted(() => ({
  getOverviewSnapshot: vi.fn(() => ({})),
  getRecoveryByDayOfWeek: vi.fn(() => []),
  getRecoveryRange: vi.fn(() => [] as unknown[]),
  getSleepRange: vi.fn(() => [] as unknown[]),
  getStrainRange: vi.fn(() => [] as unknown[]),
  getWorkoutRowsRange: vi.fn(() => [] as unknown[]),
}));
vi.mock("@/lib/db", () => db);

import RecoveryPage from "./page";
import RecoveryDriversCard from "@/components/recovery/RecoveryDriversCard";

function findCard(node: ReactNode): ReactElement | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findCard(n);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === RecoveryDriversCard) return node;
  return findCard((node.props as { children?: ReactNode }).children);
}

const render = () => RecoveryPage({ searchParams: Promise.resolve({}) });

describe("/recovery RECOVERY_DRIVERS flag", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("flag off: no card and no extra reads", async () => {
    vi.stubEnv("RECOVERY_DRIVERS", "");
    const tree = await render();
    expect(findCard(tree)).toBeNull();
    expect(db.getWorkoutRowsRange).not.toHaveBeenCalled();
    // only the page's existing range-window reads
    expect(db.getRecoveryRange).toHaveBeenCalledTimes(1);
    expect(db.getSleepRange).toHaveBeenCalledTimes(1);
    expect(db.getStrainRange).toHaveBeenCalledTimes(1);
  });

  it("flag on: renders the card from user-scoped 120-day reads", async () => {
    vi.stubEnv("RECOVERY_DRIVERS", "1");
    const tree = await render();
    const card = findCard(tree);
    expect(card).not.toBeNull();
    expect((card!.props as { result: { status: string } }).result.status).toBe("insufficient");
    expect(db.getRecoveryRange).toHaveBeenCalledWith(7, "2026-07-31", "2026-11-27");
    expect(db.getSleepRange).toHaveBeenCalledWith(7, "2026-07-31", "2026-11-27");
    expect(db.getStrainRange).toHaveBeenCalledWith(7, "2026-07-30", "2026-11-27");
    expect(db.getWorkoutRowsRange).toHaveBeenCalledWith(7, "2026-07-30", "2026-11-27");
    for (const fn of [db.getRecoveryRange, db.getSleepRange, db.getStrainRange, db.getWorkoutRowsRange]) {
      for (const call of fn.mock.calls as unknown[][]) expect(call[0]).toBe(7);
    }
  });
});
