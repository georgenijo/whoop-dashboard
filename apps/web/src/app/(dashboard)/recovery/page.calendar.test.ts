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
  getSleepRange: vi.fn(() => []),
  getStrainRange: vi.fn(() => []),
  getWorkoutRowsRange: vi.fn(() => []),
}));
vi.mock("@/lib/db", () => db);

import RecoveryPage from "./page";
import RecoveryCalendarCard from "@/components/recovery/RecoveryCalendarCard";

function findCard(node: ReactNode): ReactElement | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findCard(n);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === RecoveryCalendarCard) return node;
  return findCard((node.props as { children?: ReactNode }).children);
}

const render = () => RecoveryPage({ searchParams: Promise.resolve({ range: "30d" }) });

describe("/recovery RECOVERY_CALENDAR flag", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("flag off: no card and no extra recovery read", async () => {
    vi.stubEnv("RECOVERY_CALENDAR", "");
    const tree = await render();
    expect(findCard(tree)).toBeNull();
    // Only the existing illness-baseline read.
    expect(db.getRecoveryRange).toHaveBeenCalledTimes(1);
    expect(db.getRecoveryRange).toHaveBeenCalledWith(7, "2026-10-15", "2026-11-27");
  });

  it("flag on: one extra user-scoped 12-month read feeds the card", async () => {
    vi.stubEnv("RECOVERY_CALENDAR", "1");
    db.getRecoveryRange.mockReturnValue([
      { date: "2026-11-27", recovery_score: 82, hrv: 60, rhr: 50, spo2: 96, skin_temp: 33 },
    ]);
    const tree = await render();
    const card = findCard(tree);
    expect(card).not.toBeNull();
    expect(db.getRecoveryRange).toHaveBeenCalledTimes(2);
    expect(db.getRecoveryRange).toHaveBeenLastCalledWith(7, "2025-11-28", "2026-11-27");
    const cal = (card!.props as { calendar: { daysScored: number; today: string } }).calendar;
    expect(cal.today).toBe("2026-11-27");
    expect(cal.daysScored).toBe(1);
  });
});
