// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/auth", () => ({
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7, timezone: "America/New_York" }, source: "web" })),
}));

const base = {
  sport: "Running",
  duration_sec: 3600,
  avg_hr: 150,
  max_hr: 175,
  strain: 12,
  kilojoule: 2500,
  distance_m: 10_000,
  zone_0_ms: 0,
  zone_1_ms: 600_000,
  zone_2_ms: 1_200_000,
  zone_3_ms: 1_200_000,
  zone_4_ms: 480_000,
  zone_5_ms: 120_000,
  start_utc: null,
  end_utc: null,
};

const db = vi.hoisted(() => ({
  getWorkoutDetail: vi.fn(),
  getBodyMeasurements: vi.fn(() => null),
  getRecoveryTrend: vi.fn(() => []),
  getSimilarWorkoutCandidates: vi.fn(),
}));
vi.mock("@/lib/db", () => db);

import WorkoutDetailPage from "./page";

async function renderPage(): Promise<string> {
  const el = await WorkoutDetailPage({ params: Promise.resolve({ id: "t" }) });
  return renderToStaticMarkup(el);
}

describe("workout detail — SIMILAR_WORKOUTS flag", () => {
  beforeEach(() => {
    db.getWorkoutDetail.mockReturnValue({
      workout: { ...base, id: "t", date: "2026-11-20", avg_hr: 160, strain: 14 },
      hrSeries: null,
      source: "whoop",
    });
    db.getSimilarWorkoutCandidates.mockReturnValue([{ ...base, id: "a", date: "2026-11-12" }]);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("off: no extra read and no card; markup identical to unset", async () => {
    vi.stubEnv("SIMILAR_WORKOUTS", "");
    const unset = await renderPage();
    vi.stubEnv("SIMILAR_WORKOUTS", "true"); // anything but "1" is off
    const truthyButOff = await renderPage();
    expect(db.getSimilarWorkoutCandidates).not.toHaveBeenCalled();
    expect(unset).not.toContain("similar-workouts-card");
    expect(truthyButOff).toBe(unset);
  });

  it("on: one bounded, user-scoped read and the card renders", async () => {
    vi.stubEnv("SIMILAR_WORKOUTS", "1");
    const html = await renderPage();
    expect(db.getSimilarWorkoutCandidates).toHaveBeenCalledTimes(1);
    expect(db.getSimilarWorkoutCandidates).toHaveBeenCalledWith(7, "Running", "t", "2025-11-20", "2026-11-30");
    expect(html).toContain("similar-workouts-card");
    expect(html).toContain("Higher intensity than usual");
  });
});
