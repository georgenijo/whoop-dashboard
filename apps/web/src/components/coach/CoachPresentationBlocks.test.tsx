import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CoachPresentationBlocks from "./CoachPresentationBlocks";
import type { CoachPresentationBlock } from "@/lib/coach/presentation";

const blocks: CoachPresentationBlock[] = [
  { version: 1, type: "metric_strip", fallback: "Recovery 78 percent.", metrics: [{ label: "Recovery", value: 78, display_value: "78%", unit: "%", direction: "up", tone: "positive" }] },
  { version: 1, type: "comparison", fallback: "HRV comparison.", title: "This week", items: [{ label: "HRV", current: 62, baseline: 58, delta: 4, unit: "ms", direction: "up" }] },
  { version: 1, type: "chart", fallback: "HRV rose from 60 to 62 milliseconds.", title: "HRV trend", labels: ["Mon", "Tue"], series: [{ id: "hrv", label: "HRV", unit: "ms", kind: "line", values: [60, 62] }], references: [{ label: "Baseline", value: 58, unit: "ms" }], anomalies: [{ index: 1, label: "High" }] },
  { version: 1, type: "action_plan", fallback: "Easy work today.", title: "Next steps", sections: [{ timeframe: "today", items: ["Easy aerobic work"] }] },
  { version: 1, type: "data_freshness", fallback: "Whoop is fresh.", sources: [{ source: "Whoop", status: "fresh", last_available_date: "2026-08-18" }], sync_available: false },
  { version: 1, type: "workout_plan", fallback: "Run preview.", title: "Easy run", date: null, exercises: [{ name: "Run", prescription: "30 min zone 2", notes: "Conversational" }] },
  { version: 1, type: "evidence", fallback: "Seven records.", title: "Evidence", date_range: "Aug 12-18", record_count: 7, missing_days: 0, sources: ["Whoop"], points: ["HRV rose"] },
];

describe("CoachPresentationBlocks", () => {
  afterEach(cleanup);
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders equivalent readable meaning for every initial block type", () => {
    render(<CoachPresentationBlocks blocks={blocks} />);
    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.getByText("This week", { selector: "summary span" })).toBeInTheDocument();
    expect(screen.getByText("HRV trend")).toBeInTheDocument();
    expect(screen.getByText("Easy aerobic work")).toBeInTheDocument();
    expect(screen.getByText("Whoop")).toBeInTheDocument();
    expect(screen.getByText("30 min zone 2", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Evidence")).toBeInTheDocument();
  });

  it("switches a chart to its accessible table and copies tabular data", async () => {
    const { container } = render(<CoachPresentationBlocks blocks={[blocks[2]]} />);
    const view = within(container);
    fireEvent.click(view.getByRole("button", { name: "Table" }));
    expect(view.getByRole("table", { name: "HRV trend" })).toBeInTheDocument();
    fireEvent.click(view.getByRole("button", { name: "Copy table" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "Period\tHRV (ms)\tNote\nMon\t60\t\nTue\t62\tHigh",
    );
  });

  it("keeps a full comparison closed until requested and shows arrows with percentage points", () => {
    const comparison: CoachPresentationBlock = {
      version: 1,
      type: "comparison",
      title: "Today vs 14-day average",
      fallback: "Recovery is steady and sleep performance improved.",
      items: [
        { label: "Recovery", current: 66, baseline: 67, delta: -1, unit: "%", direction: "down" },
        { label: "Sleep performance", current: 79, baseline: 74, delta: 5, unit: "%", direction: "up" },
        { label: "Resting HR", current: 57, baseline: 57, delta: 0, unit: "bpm", direction: "neutral" },
        { label: "HRV", current: null, baseline: 47.8, delta: null, unit: "ms", direction: "neutral" },
      ],
    };
    const { container } = render(<CoachPresentationBlocks blocks={[comparison]} />);
    const disclosure = container.querySelector("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByText("66%")).not.toBeVisible();
    expect(container).toHaveTextContent("↓ 1 pt");
    expect(container).toHaveTextContent("↑ 5 pts");
    expect(container).toHaveTextContent("Unchanged");
    expect(container).toHaveTextContent("Not available");
    expect(container).not.toHaveTextContent("Δ");
    expect(container).not.toHaveTextContent("-1%");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  });

  it("derives the change from the displayed values despite contradictory model metadata", () => {
    const { container } = render(<CoachPresentationBlocks blocks={[{
      version: 1,
      type: "comparison",
      title: "HRV",
      fallback: "HRV fell by 2 ms.",
      items: [{ label: "HRV", current: 45.8, baseline: 47.8, delta: 2, unit: "ms", direction: "up" }],
    }]} />);
    expect(container).toHaveTextContent("↓ 2 ms");
    expect(container).not.toHaveTextContent("↑");
  });

  it.each([1, 0, null])("derives percentage points when the supplied delta is %s", (delta) => {
    const { container } = render(<CoachPresentationBlocks blocks={[{
      version: 1, type: "comparison", title: "Recovery", fallback: "Recovery is 1 point lower.",
      items: [{ label: "Recovery", current: 66, baseline: 67, delta, unit: "%", direction: "up" }],
    }]} />);
    expect(container).toHaveTextContent("↓ 1 pt");
    expect(container).not.toHaveTextContent("Unchanged");
  });

  it("does not round a small difference into an unchanged value", () => {
    const { container } = render(<CoachPresentationBlocks blocks={[{
      version: 1, type: "comparison", title: "Small difference", fallback: "A small increase.",
      items: [{ label: "HRV", current: 47.804, baseline: 47.8, delta: null, unit: "ms", direction: "neutral" }],
    }]} />);
    expect(container).toHaveTextContent("↑ <0.01 ms");
    expect(container).not.toHaveTextContent("Unchanged");
  });

  it("shows three key metrics and keeps the rest available without repeating units", () => {
    render(<CoachPresentationBlocks blocks={[{
      version: 1,
      type: "metric_strip",
      fallback: "Recovery, sleep, heart rate and HRV.",
      metrics: [
        { label: "Recovery", value: 66, display_value: "66%", unit: "%", direction: "neutral", tone: "neutral" },
        { label: "Sleep performance", value: 79, display_value: "79%", unit: "%", direction: "up", tone: "positive" },
        { label: "Resting HR", value: 57, display_value: "57", unit: "bpm", direction: "neutral", tone: "neutral" },
        { label: "HRV", value: null, display_value: "0 ms", unit: "ms", direction: "down", tone: "neutral" },
      ],
    }]} />);
    expect(screen.getByText("66%")).toBeVisible();
    expect(screen.getByText("79%")).toBeVisible();
    expect(screen.getByText("bpm")).toBeVisible();
    expect(screen.getByText("HRV")).not.toBeVisible();
    expect(screen.getByText("View 1 more metric")).toBeVisible();
    expect(screen.getByText("Not available")).not.toBeVisible();
    expect(screen.queryByText("0 ms")).not.toBeInTheDocument();
    expect(screen.queryByText("%", { exact: true })).not.toBeInTheDocument();
  });

  it("shows a matching comparison beside a key metric without opening the full table", () => {
    const metric: CoachPresentationBlock = { version: 1, type: "metric_strip", fallback: "Recovery is 66%.", metrics: [{ label: "Recovery", value: 66, display_value: "66%", unit: "%", direction: "down", tone: "neutral" }] };
    const comparison: CoachPresentationBlock = { version: 1, type: "comparison", title: "14-day average", fallback: "Average recovery is 67%.", items: [{ label: "Recovery", current: 66, baseline: 67, delta: -1, unit: "%", direction: "down" }] };
    const { container, rerender } = render(<CoachPresentationBlocks blocks={[metric, comparison]} />);
    expect(within(screen.getByRole("region", { name: "Recovery is 66%." })).getByText("↓ 1 pt")).toBeVisible();
    expect(screen.getByText("Baseline 67%")).toBeVisible();
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    rerender(<CoachPresentationBlocks blocks={[metric, comparison, { ...comparison, title: "Another period" }]} />);
    expect(screen.queryByText("Baseline 67%")).not.toBeInTheDocument();
    expect(screen.getByText("↓ Lower")).toBeVisible();
  });

  it("keeps the metric's direction when the matching baseline is unavailable", () => {
    render(<CoachPresentationBlocks blocks={[
      { version: 1, type: "metric_strip", fallback: "HRV is 45.8 ms.", metrics: [{ label: "HRV", value: 45.8, display_value: "45.8 ms", unit: "ms", direction: "down", tone: "neutral" }] },
      { version: 1, type: "comparison", title: "HRV baseline", fallback: "No baseline is available.", items: [{ label: "HRV", current: 45.8, baseline: null, delta: null, unit: "ms", direction: "neutral" }] },
    ]} />);
    const metric = within(screen.getByRole("region", { name: "HRV is 45.8 ms." }));
    expect(metric.getByText("45.8 ms")).toBeVisible();
    expect(metric.getByText("↓ Lower")).toBeVisible();
    expect(metric.queryByText("Not available")).not.toBeInTheDocument();
  });
});
