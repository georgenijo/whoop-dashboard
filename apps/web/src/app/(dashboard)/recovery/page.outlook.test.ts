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
import RecoveryOutlookCard from "@/components/recovery/RecoveryOutlookCard";

function findCard(node: ReactNode): ReactElement | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findCard(n);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === RecoveryOutlookCard) return node;
  return findCard((node.props as { children?: ReactNode }).children);
}

const render = () => RecoveryPage({ searchParams: Promise.resolve({}) });

describe("/recovery RECOVERY_OUTLOOK flag", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  for (const value of ["", "0", "true"]) {
    it(`flag ${JSON.stringify(value)}: no card and no extra reads`, async () => {
      vi.stubEnv("RECOVERY_OUTLOOK", value);
      vi.stubEnv("RECOVERY_DRIVERS", "");
      vi.stubEnv("RECOVERY_CALENDAR", "");
      const tree = await render();
      expect(findCard(tree)).toBeNull();
      expect(db.getRecoveryRange).toHaveBeenCalledTimes(1);
      expect(db.getSleepRange).toHaveBeenCalledTimes(1);
      expect(db.getStrainRange).toHaveBeenCalledTimes(1);
    });
  }

  it("flag on: renders the card from three user-scoped 90-day reads", async () => {
    vi.stubEnv("RECOVERY_OUTLOOK", "1");
    vi.stubEnv("RECOVERY_DRIVERS", "");
    vi.stubEnv("RECOVERY_CALENDAR", "");
    const tree = await render();
    const card = findCard(tree);
    expect(card).not.toBeNull();
    expect((card!.props as { outlook: { status: string } }).outlook.status).toBe("insufficient");
    expect(db.getRecoveryRange).toHaveBeenCalledTimes(2);
    expect(db.getRecoveryRange).toHaveBeenCalledWith(7, "2026-08-30", "2026-11-27");
    expect(db.getSleepRange).toHaveBeenCalledWith(7, "2026-08-30", "2026-11-27");
    expect(db.getStrainRange).toHaveBeenCalledWith(7, "2026-08-29", "2026-11-27");
    expect(db.getWorkoutRowsRange).not.toHaveBeenCalled();
    for (const fn of [db.getRecoveryRange, db.getSleepRange, db.getStrainRange]) {
      for (const call of fn.mock.calls as unknown[][]) expect(call[0]).toBe(7);
    }
  });
});
