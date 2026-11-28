// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MonthlyRollupRow, WorkoutRow } from "@/lib/db";

vi.mock("server-only", () => ({}));

const { notFound, db } = vi.hoisted(() => ({
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  db: {
    getWorkoutRowsRange: vi.fn(),
    getMonthlyRollup: vi.fn(),
  },
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/lib/auth", () => ({
  requireAuthOrSignin: vi.fn(async () => ({ user: { id: 7 }, source: "web" })),
}));
vi.mock("@/lib/date", () => ({ localToday: () => "2026-11-27" }));
vi.mock("@/lib/db", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/workouts")>("@/lib/db/workouts");
  return {
    capWorkoutRows: actual.capWorkoutRows,
    getWorkoutRowsRange: db.getWorkoutRowsRange,
    getMonthlyRollup: db.getMonthlyRollup,
  };
});

import SportStatsPage from "./page";

function row(id: string, date: string, over: Partial<WorkoutRow> = {}): WorkoutRow {
  return {
    id,
    date,
    sport: "HIIT/Circuit",
    duration_sec: 3600,
    avg_hr: 150,
    max_hr: 180,
    strain: 12,
    kilojoule: 2000,
    distance_m: null,
    zone_0_ms: null,
    zone_1_ms: null,
    zone_2_ms: null,
    zone_3_ms: null,
    zone_4_ms: null,
    zone_5_ms: null,
    start_utc: null,
    end_utc: null,
    ...over,
  };
}

const MONTHS: MonthlyRollupRow[] = [
  { month: "2026-09", count: 2, avgStrain: 11, avgHr: 148, partial: false },
  { month: "2026-10", count: 1, avgStrain: 13, avgHr: null, partial: false },
  { month: "2026-11", count: 3, avgStrain: 12.5, avgHr: 152, partial: true },
];

async function render(sport: string, range?: string): Promise<string> {
  const el = await SportStatsPage({
    params: Promise.resolve({ sport }),
    searchParams: Promise.resolve(range ? { range } : {}),
  });
  return renderToStaticMarkup(el);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.getWorkoutRowsRange.mockReturnValue([]);
  db.getMonthlyRollup.mockReturnValue([]);
});

describe("/stats/[sport] (issue #430)", () => {
  it("decodes the segment and queries the shared aggregations with that sport", async () => {
    db.getWorkoutRowsRange.mockReturnValue([row("a", "2026-11-20"), row("b", "2026-09-02")]);
    db.getMonthlyRollup.mockReturnValue(MONTHS);
    const html = await render("HIIT%2FCircuit", "90d");

    expect(db.getWorkoutRowsRange).toHaveBeenCalledWith(7, "2026-08-30", "2026-11-27", "HIIT/Circuit");
    expect(db.getMonthlyRollup).toHaveBeenCalledWith(7, "2026-08-30", "2026-11-27", "HIIT/Circuit");
    expect(html).toContain("HIIT/Circuit sessions");
    expect(html).toContain("2 sessions");
    // session rows link to the workout detail screen
    expect(html).toContain('href="/workouts/a"');
    expect(html).toContain('href="/workouts/b"');
    // back link keeps the range
    expect(html).toContain('href="/stats?range=90d"');
  });

  it("feeds the aggregated monthly series to both trend charts", async () => {
    db.getWorkoutRowsRange.mockReturnValue([row("a", "2026-11-20")]);
    db.getMonthlyRollup.mockReturnValue(MONTHS);
    const html = await render("Running");

    // strain: all 3 months carry strain; HR: Oct has none → 2 points
    expect(html).toMatch(/data-trend-line="avgStrain" data-points="3"/);
    expect(html).toMatch(/data-trend-line="avgHr" data-points="2"/);
    expect(html).toContain(">148<");
    expect(html).toContain(">152<");
  });

  it("summarises the listed sessions in the headline strip", async () => {
    db.getWorkoutRowsRange.mockReturnValue([
      row("a", "2026-11-20", { duration_sec: 3600, strain: 10, avg_hr: 140 }),
      row("b", "2026-11-10", { duration_sec: 1800, strain: 14, avg_hr: 160 }),
    ]);
    db.getMonthlyRollup.mockReturnValue(MONTHS);
    const html = await render("Running");
    expect(html).toContain("1.5<span class=\"u\">h</span>");
    expect(html).toContain(">12.0<");
    expect(html).toContain("150<span class=\"u\">bpm</span>");
  });

  it("renders an empty state, not charts, when the sport has no sessions in range", async () => {
    const html = await render("Rowing", "30d");
    expect(html).toContain('data-testid="sport-empty"');
    expect(html).toContain("No Rowing sessions in last 30 days");
    expect(html).toContain('href="?range=all"');
    expect(html).not.toContain("data-trend-line");
  });

  it("all-time empty state points back to Stats", async () => {
    const html = await render("Rowing", "all");
    expect(html).toContain("No Rowing sessions in your history");
    expect(html).toContain('href="/stats"');
  });

  it("404s a blank segment", async () => {
    await expect(render("%20")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(db.getWorkoutRowsRange).not.toHaveBeenCalled();
  });
});
