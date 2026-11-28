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
  getStrainRange: vi.fn(() => [] as { date: string; strain: number | null }[]),
  getTodayStrainAggregate: vi.fn(() => ({ total_kilojoule: null, workout_count: 1, avg_hr: null, max_hr: null })),
  getTodayWorkouts: vi.fn(() => [] as { strain: number | null }[]),
  getRecoveryRange: vi.fn(() => [] as unknown[]),
}));
vi.mock("@/lib/db", () => db);

import StrainPage from "./page";
import StrainTargetCard from "@/components/strain/StrainTargetCard";

function findCard(node: ReactNode): ReactElement | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findCard(n);
      if (hit) return hit;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === StrainTargetCard) return node;
  return findCard((node.props as { children?: ReactNode }).children);
}

const render = () => StrainPage({ searchParams: Promise.resolve({}) });

describe("/strain STRAIN_TARGET flag", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("flag off: no card and no recovery read", async () => {
    vi.stubEnv("STRAIN_TARGET", "");
    const tree = await render();
    expect(findCard(tree)).toBeNull();
    expect(db.getRecoveryRange).not.toHaveBeenCalled();
  });

  it("flag on: renders the card from one user-scoped 28-day recovery read", async () => {
    vi.stubEnv("STRAIN_TARGET", "1");
    db.getRecoveryRange.mockReturnValue([
      { date: "2026-11-27", recovery_score: 82, hrv: 60, rhr: 50, spo2: 96, skin_temp: 33 },
    ]);
    db.getStrainRange.mockReturnValue([
      { date: "2026-11-26", strain: 12 },
      { date: "2026-11-27", strain: 7.3 },
    ]);
    const tree = await render();
    const card = findCard(tree);
    expect(card).not.toBeNull();
    const props = card!.props as Record<string, unknown>;
    expect(db.getRecoveryRange).toHaveBeenCalledTimes(1);
    expect(db.getRecoveryRange).toHaveBeenCalledWith(7, "2026-10-31", "2026-11-27");
    expect(props.strainSoFar).toBe(7.3);
    expect(props.strainSource).toBe("cycle");
    expect(props.workoutCount).toBe(1);
    expect((props.target as { status: string }).status).toBe("ok");
  });
});
