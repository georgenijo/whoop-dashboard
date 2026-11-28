import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import ChartMarkers from "./ChartMarkers";
import HRVTrend from "./HRVTrend";
import TrendChart from "./TrendChart";
import { FIXTURE_DATES, FIXTURE_HRV, FIXTURE_RECOVERY } from "./__fixtures__/chartMarkersFixture";
import { buildChartMarkers, type ChartMarker } from "@/lib/analytics/chartMarkers";

const FIXTURES = path.join(process.cwd(), "src/components/charts/__fixtures__");

const MARKERS: ChartMarker[] = buildChartMarkers({
  start: FIXTURE_DATES[0],
  end: FIXTURE_DATES[29],
  recovery: [
    { date: "2026-10-31", recovery_score: 88 },
    { date: "2026-11-01", recovery_score: 51 },
  ],
  cycles: [{ date: "2026-10-25", strain: 17.2 }],
  workouts: [
    { date: "2026-10-22", sport: "running", strain: 6 },
    { date: "2026-10-25", sport: "cycling", strain: 15.1 },
    { date: "2026-11-01", sport: "yoga", strain: 3 },
  ],
  journal: [{ date: "2026-11-01", title: "Alcohol", tags: "late meal" }],
});

function recoveryChart(markers?: ChartMarker[]) {
  return (
    <TrendChart
      title="Recovery score"
      subtitle="Last 30 days"
      color="#00d4aa"
      gradientId="recovery"
      data={FIXTURE_RECOVERY}
      unit="%"
      showRollingToggle
      markers={markers}
    />
  );
}

describe("flag off: charts are byte-identical to the pre-markers baseline", () => {
  // The .html files were rendered from TrendChart/HRVTrend before marker
  // support was added (same fixture data). The page passes `markers={undefined}`
  // when CHART_MARKERS is off, which must change nothing.
  it("TrendChart (recovery score)", () => {
    const baseline = readFileSync(path.join(FIXTURES, "TrendChart.recovery.flagoff.html"), "utf8");
    expect(renderToStaticMarkup(recoveryChart(undefined))).toBe(baseline);
  });

  it("HRVTrend", () => {
    const baseline = readFileSync(path.join(FIXTURES, "HRVTrend.flagoff.html"), "utf8");
    expect(renderToStaticMarkup(<HRVTrend subtitle="Last 30 days" data={FIXTURE_HRV} markers={undefined} />)).toBe(
      baseline,
    );
  });

  it("flag on: the baseline chart is untouched and only the marker block is appended", () => {
    const baseline = readFileSync(path.join(FIXTURES, "TrendChart.recovery.flagoff.html"), "utf8");
    const on = renderToStaticMarkup(recoveryChart(MARKERS));
    expect(on).not.toBe(baseline);
    const marker = on.indexOf('<div class="chart-markers"');
    expect(marker).toBeGreaterThan(0);
    // Everything before the marker block equals the baseline minus its closing </div>.
    expect(on.slice(0, marker)).toBe(baseline.slice(0, -"</div>".length));
  });
});

describe("ChartMarkers", () => {
  afterEach(cleanup);

  it("empty markers: no marker buttons, legend still shows zero counts", () => {
    render(<ChartMarkers markers={[]} plottedDates={FIXTURE_DATES} chartLabel="Recovery score" />);
    expect(document.querySelectorAll("[data-marker-kind]")).toHaveLength(0);
    const legend = screen.getByRole("group", { name: "Show event markers" });
    expect(within(legend).getByRole("button", { name: /Workouts\s*0/ })).toBeInTheDocument();
  });

  it("each marker is a focusable button with a shape and an aria-label naming event and date", () => {
    render(<ChartMarkers markers={MARKERS} plottedDates={FIXTURE_DATES} chartLabel="Recovery score" />);
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-marker-kind]"));
    expect(buttons.map((b) => [b.dataset.markerKind, b.dataset.markerDate])).toEqual([
      ["workout", "2026-10-22"],
      ["high-strain", "2026-10-25"],
      ["workout", "2026-11-01"],
      ["journal", "2026-11-01"],
      ["drop", "2026-11-01"],
    ]);
    for (const b of buttons) {
      expect(b.tabIndex).toBe(0);
      expect(b.querySelector("svg polygon, svg rect")).not.toBeNull();
    }
    expect(screen.getByRole("button", { name: "Sun, Nov 1: Recovery dropped 37 points (88% → 51%)" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sun, Oct 25: Cycling (strain 15.1) · high-strain day 17.2" }),
    ).toBeInTheDocument();
    // Distinct shapes per kind, so colour is never the only cue.
    const shape = (kind: string) =>
      document.querySelector(`[data-marker-kind="${kind}"] svg`)!.innerHTML.replace(/fill="[^"]*"/, "");
    const shapes = new Set(["workout", "high-strain", "journal", "drop"].map(shape));
    expect(shapes.size).toBe(4);
  });

  it("focus shows a tooltip with the event and date; blur hides it", () => {
    render(<ChartMarkers markers={MARKERS} plottedDates={FIXTURE_DATES} chartLabel="Recovery score" />);
    const drop = screen.getByRole("button", { name: /Recovery dropped/ });
    fireEvent.focus(drop);
    const tip = screen.getByRole("tooltip");
    expect(tip).toHaveTextContent("Big drop");
    expect(tip).toHaveTextContent("Sun, Nov 1: Recovery dropped 37 points");
    expect(drop.getAttribute("aria-describedby")).toBe(tip.id);
    fireEvent.blur(drop);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("legend toggles hide and restore a category with aria-pressed", () => {
    render(<ChartMarkers markers={MARKERS} plottedDates={FIXTURE_DATES} chartLabel="Recovery score" />);
    const toggle = screen.getByRole("button", { name: /Workouts/ });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(document.querySelectorAll('[data-marker-kind="workout"], [data-marker-kind="high-strain"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-marker-kind="drop"]')).toHaveLength(1);
    fireEvent.click(toggle);
    expect(document.querySelectorAll('[data-marker-kind="workout"]')).toHaveLength(2);
  });

  it("dense data clusters within a lane and labels the cluster", () => {
    const dates = Array.from({ length: 365 }, (_, i) => new Date(Date.UTC(2025, 10, 28 + i)).toISOString().slice(0, 10));
    const dense = buildChartMarkers({
      start: dates[0],
      end: dates[364],
      recovery: [],
      cycles: [],
      workouts: dates.map((date) => ({ date, sport: "running", strain: 9 })),
      journal: [],
    });
    render(<ChartMarkers markers={dense} plottedDates={dates} chartLabel="HRV trend" />);
    const buttons = document.querySelectorAll<HTMLButtonElement>("button[data-marker-kind]");
    expect(buttons.length).toBeLessThan(50);
    expect(buttons[0].getAttribute("aria-label")).toMatch(/^\d+ workout days, /);
    expect(screen.getByRole("button", { name: /Workouts\s*365/ })).toBeInTheDocument();
  });

  it("charts render the marker lane only when markers are passed", () => {
    const { unmount } = render(recoveryChart(MARKERS));
    expect(screen.getByRole("group", { name: "Recovery score event markers" })).toBeInTheDocument();
    unmount();
    render(<HRVTrend subtitle="Last 30 days" data={FIXTURE_HRV} markers={MARKERS} />);
    expect(screen.getByRole("group", { name: "HRV trend event markers" })).toBeInTheDocument();
    cleanup();
    render(recoveryChart(undefined));
    expect(screen.queryByTestId("chart-markers")).toBeNull();
  });
});
