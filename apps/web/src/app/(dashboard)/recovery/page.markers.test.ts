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
  getStrainRange: vi.fn(() => [] as unknown[]),
  getWorkoutRowsRange: vi.fn(() => [] as unknown[]),
  getJournalRange: vi.fn(() => [] as unknown[]),
}));
vi.mock("@/lib/db", () => db);

import RecoveryPage from "./page";
import TrendChart from "@/components/charts/TrendChart";
import HRVTrend from "@/components/charts/HRVTrend";

function findAll(node: ReactNode, types: unknown[], out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const n of node) findAll(n, types, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  if (types.includes(node.type)) out.push(node);
  findAll((node.props as { children?: ReactNode }).children, types, out);
  return out;
}

const render = () => RecoveryPage({ searchParams: Promise.resolve({ range: "30d" }) });
const markersOf = (el: ReactElement) => (el.props as { markers?: unknown }).markers;
const titleOf = (el: ReactElement) => (el.props as { title?: string }).title ?? "HRV trend";

describe("/recovery CHART_MARKERS flag", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  for (const value of ["", "0", "true"]) {
    it(`flag ${JSON.stringify(value)}: no workout/journal reads, no markers prop on any chart`, async () => {
      vi.stubEnv("CHART_MARKERS", value);
      vi.stubEnv("RECOVERY_DRIVERS", "");
      const tree = await render();
      expect(db.getWorkoutRowsRange).not.toHaveBeenCalled();
      expect(db.getJournalRange).not.toHaveBeenCalled();
      const charts = findAll(tree, [TrendChart, HRVTrend]);
      expect(charts).toHaveLength(3);
      for (const c of charts) {
        expect(markersOf(c)).toBeUndefined();
      }
    });
  }

  it("flag on: one window-bounded user-scoped read each, markers on recovery + HRV only", async () => {
    vi.stubEnv("CHART_MARKERS", "1");
    vi.stubEnv("RECOVERY_DRIVERS", "");
    db.getRecoveryRange.mockReturnValue([
      { date: "2026-10-28", recovery_score: 90, hrv: 70, rhr: 50, spo2: 96, skin_temp: 33 },
      { date: "2026-10-29", recovery_score: 45, hrv: 50, rhr: 55, spo2: 96, skin_temp: 33 },
    ]);
    db.getStrainRange.mockReturnValue([{ date: "2026-11-02", strain: 18.1 }]);
    db.getWorkoutRowsRange.mockReturnValue([{ id: "w1", date: "2026-11-03", sport: "running", strain: 11 }]);
    db.getJournalRange.mockReturnValue([{ date: "2026-11-04", title: "Alcohol", content: null, mood: null, tags: null }]);

    const tree = await render();
    expect(db.getWorkoutRowsRange).toHaveBeenCalledTimes(1);
    expect(db.getWorkoutRowsRange).toHaveBeenCalledWith(7, "2026-10-29", "2026-11-27");
    expect(db.getJournalRange).toHaveBeenCalledTimes(1);
    expect(db.getJournalRange).toHaveBeenCalledWith(7, "2026-10-29", "2026-11-27");

    const charts = findAll(tree, [TrendChart, HRVTrend]);
    const byTitle = Object.fromEntries(charts.map((c) => [titleOf(c), markersOf(c)]));
    expect(byTitle["Resting Heart Rate"]).toBeUndefined();
    const markers = byTitle["Recovery score"] as { date: string; kind: string }[];
    expect(byTitle["HRV trend"]).toBe(markers);
    expect(markers.map((m) => `${m.date}:${m.kind}`)).toEqual([
      // The drop on the window's first day pairs with the pre-window day.
      "2026-10-29:drop",
      "2026-11-02:high-strain",
      "2026-11-03:workout",
      "2026-11-04:journal",
    ]);
  });
});
