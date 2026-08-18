import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders equivalent readable meaning for every initial block type", () => {
    render(<CoachPresentationBlocks blocks={blocks} />);
    expect(screen.getByText("78%")).toBeInTheDocument();
    expect(screen.getByText("This week")).toBeInTheDocument();
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
});
