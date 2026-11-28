// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/auth", () => ({
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
}));

const row = (id: string, date: string, over: Record<string, unknown> = {}) => ({
  id,
  date,
  sport: "Running",
  duration_sec: 3600,
  avg_hr: 150,
  max_hr: 175,
  strain: 12,
  kilojoule: 2500,
  distance_m: 10_000,
  zone_0_ms: 0,
  zone_1_ms: 1,
  zone_2_ms: 1,
  zone_3_ms: 1,
  zone_4_ms: 1,
  zone_5_ms: 0,
  start_utc: null,
  end_utc: null,
  ...over,
});

const db = vi.hoisted(() => ({
  getWorkoutRowsRange: vi.fn(),
  getBodyMeasurements: vi.fn(() => null),
  capWorkoutRows: vi.fn((rows: unknown[]) => ({ rows, truncated: false, total_count: rows.length })),
}));
vi.mock("@/lib/db", () => db);

import WorkoutsPage from "./page";
import WorkoutsTable from "@/components/workouts/WorkoutsTable";

type El = { type: unknown; props: Record<string, unknown> };
function findTable(node: unknown): El | null {
  if (!node || typeof node !== "object") return null;
  const el = node as El;
  if (el.type === WorkoutsTable) return el;
  const kids = el.props?.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const hit = findTable(k);
    if (hit) return hit;
  }
  return null;
}

describe("/workouts — SIMILAR_WORKOUTS flag", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  const rows = [row("new", "2026-11-20", { avg_hr: 165, strain: 15 }), row("old", "2026-11-10")];

  it("off: table gets no vsUsual prop", async () => {
    vi.stubEnv("SIMILAR_WORKOUTS", "0");
    db.getWorkoutRowsRange.mockReturnValue(rows);
    const table = findTable(await WorkoutsPage({ searchParams: Promise.resolve({}) }));
    expect(table).not.toBeNull();
    expect(table!.props.vsUsual).toBeUndefined();
    expect(db.getWorkoutRowsRange).toHaveBeenCalledTimes(1);
  });

  it("on: chips come from the same single range read (no extra query)", async () => {
    vi.stubEnv("SIMILAR_WORKOUTS", "1");
    db.getWorkoutRowsRange.mockReturnValue(rows);
    const table = findTable(await WorkoutsPage({ searchParams: Promise.resolve({}) }));
    expect(db.getWorkoutRowsRange).toHaveBeenCalledTimes(1);
    expect(table!.props.vsUsual).toEqual({ new: { verdict: "higher-intensity", n: 1, label: "↑ harder" } });
  });
});
