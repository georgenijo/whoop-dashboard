// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
}));

const db = vi.hoisted(() => ({
  getWorkoutRowsRange: vi.fn(() => []),
  getBodyMeasurements: vi.fn(() => null),
  capWorkoutRows: vi.fn((rows: unknown[]) => ({ rows, truncated: false, total_count: rows.length })),
}));
vi.mock("@/lib/db", () => db);

import WorkoutsPage from "./page";

type El = { type: unknown; props: Record<string, unknown> };
function findByTestId(node: unknown, id: string): El | null {
  if (!node || typeof node !== "object") return null;
  const el = node as El;
  if (el.props?.["data-testid"] === id) return el;
  const kids = el.props?.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const hit = findByTestId(k, id);
    if (hit) return hit;
  }
  return null;
}

describe("/workouts calendar link (WORKOUT_CALENDAR)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it.each([undefined, "0", "true"])("WORKOUT_CALENDAR=%s: no link and no extra reads", async (v) => {
    vi.stubEnv("WORKOUT_CALENDAR", v as string);
    const tree = await WorkoutsPage({ searchParams: Promise.resolve({}) });
    expect(findByTestId(tree, "workout-calendar-link")).toBeNull();
    expect(db.getWorkoutRowsRange).toHaveBeenCalledTimes(1);
  });

  it("WORKOUT_CALENDAR=1: link to /workouts/calendar, still one read", async () => {
    vi.stubEnv("WORKOUT_CALENDAR", "1");
    const tree = await WorkoutsPage({ searchParams: Promise.resolve({}) });
    const link = findByTestId(tree, "workout-calendar-link");
    expect(link?.props.href).toBe("/workouts/calendar");
    expect(db.getWorkoutRowsRange).toHaveBeenCalledTimes(1);
  });
});
