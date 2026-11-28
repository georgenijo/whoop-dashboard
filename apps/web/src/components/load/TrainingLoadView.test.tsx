// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildLoadSummary, shiftDay, type DailyStrain } from "@/lib/analytics/acwr";
import TrainingLoadView, { CHART_MAX_RATIO, ratioPath } from "./TrainingLoadView";

const TODAY = "2026-11-27";
const days = (n: number, f: (i: number) => number | null, end = TODAY): DailyStrain[] =>
  Array.from({ length: n }, (_, i) => ({ date: shiftDay(end, i - (n - 1)), strain: f(i) }));

describe("TrainingLoadView", () => {
  it("renders ratio, zone, chart bands, projection and suggestion with full history", () => {
    const html = renderToString(<TrainingLoadView summary={buildLoadSummary(days(140, () => 10), TODAY)} />);
    expect(html).toContain("Training Load Balance");
    expect(html).toContain("1.00");
    expect(html).toContain("Sweet spot");
    for (const z of ["undertrained", "sweet-spot", "caution", "high"]) {
      expect(html).toContain(`data-zone="${z}"`);
    }
    expect(html).toContain('data-testid="load-ratio-line"');
    expect(html).toContain("Rest day · strain 4");
    expect(html).toContain("Hard day · strain 16");
    expect(html).toContain("Nov 28");
    expect(html).toContain('data-testid="load-suggestion"');
    expect(html).toContain("not medical advice");
    // Server-rendered markup only — no client hooks/handlers.
    expect(html).not.toContain("onClick");
  });

  it("shows the building-baseline empty state instead of a chart", () => {
    const html = renderToString(<TrainingLoadView summary={buildLoadSummary(days(5, () => 8), TODAY)} />);
    expect(html).toContain("Building baseline");
    expect(html).toContain("23 to go");
    expect(html).not.toContain('data-testid="load-ratio-line"');
  });

  it("renders with no data at all", () => {
    const html = renderToString(<TrainingLoadView summary={buildLoadSummary([], TODAY)} />);
    expect(html).toContain("No data");
    expect(html).toContain("No strain data yet");
    expect(html).toContain("—");
  });

  it("renders the zero-baseline state without NaN or Infinity", () => {
    const html = renderToString(<TrainingLoadView summary={buildLoadSummary(days(60, () => 0), TODAY)} />);
    expect(html).toContain("No baseline load");
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});

describe("ratioPath", () => {
  const p = (ratio: number | null) => ({
    date: TODAY, ratio, acute: null, chronic: null, zone: null, status: "ok" as const, acuteDays: 0, chronicDays: 0,
  });

  it("breaks the line at null ratios and clamps above the chart ceiling", () => {
    const d = ratioPath([p(1), p(1), p(null), p(CHART_MAX_RATIO * 3), p(0)]);
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).toContain("M75.00,0.00");
    expect(d).toContain("L100.00,100.00");
  });

  it("handles empty and single-point series", () => {
    expect(ratioPath([])).toBe("");
    expect(ratioPath([p(1)])).toBe("M50.00,50.00");
  });
});
