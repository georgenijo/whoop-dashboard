import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 1 }, source: "web" })),
}));
vi.mock("@/lib/db", () => ({
  getWorkoutDetail: vi.fn(() => ({
    workout: {
      id: "w1", date: "2026-11-20", sport: "Running", duration_sec: 1800, avg_hr: 150, max_hr: 175,
      strain: 10, kilojoule: 1500, distance_m: null, zone_0_ms: null, zone_1_ms: null, zone_2_ms: null,
      zone_3_ms: null, zone_4_ms: null, zone_5_ms: null, start_utc: null, end_utc: null,
    },
    hrSeries: null,
    source: "whoop",
  })),
  getBodyMeasurements: vi.fn(() => null),
  getRecoveryTrend: vi.fn(() => []),
}));

import WorkoutDetailPage from "./page";

afterEach(() => {
  cleanup();
  delete process.env.DAY_DETAIL;
});

async function renderPage() {
  render(await WorkoutDetailPage({ params: Promise.resolve({ id: "w1" }) }));
}

describe("workout detail → Day detail entry point", () => {
  it("flag off: the date is plain text, no /day link", async () => {
    await renderPage();
    expect(document.querySelector(".detail-meta")?.textContent).toContain("Nov 20, 2026");
    expect(document.querySelector('a[href^="/day/"]')).toBeNull();
  });

  it("flag on: the date links to that day", async () => {
    process.env.DAY_DETAIL = "1";
    await renderPage();
    expect(screen.getByRole("link", { name: "Nov 20, 2026" }).getAttribute("href")).toBe("/day/2026-11-20");
  });
});
