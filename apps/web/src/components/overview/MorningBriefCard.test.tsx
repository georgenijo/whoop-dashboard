import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import MorningBriefCard from "./MorningBriefCard";
import type { MorningBriefView } from "@/lib/analytics/morningBrief";

const okBrief: MorningBriefView = {
  today: "2026-11-27",
  status: "ok",
  anchorDate: "2026-11-27",
  latestDataDate: "2026-11-27",
  lines: [
    { key: "readiness", label: "Readiness", text: "78% · Green · +16 vs 7-day avg 62%", tone: "good", note: null },
    { key: "sleep", label: "Sleep", text: "7.8 h of 8.0 h need · 90% performance", tone: "good", note: null },
    { key: "yesterday", label: "Yesterday", text: "Strain 14.2 · Running 45 min", tone: "neutral", note: null },
    { key: "suggestion", label: "Suggestion", text: "good day for a hard session.", tone: "neutral", note: null },
  ],
};

describe("MorningBriefCard", () => {
  afterEach(cleanup);

  it("renders one list item per line with label, text and tone", () => {
    render(<MorningBriefCard brief={okBrief} />);
    expect(screen.getByRole("region", { name: "Today" })).toBeInTheDocument();
    const items = within(screen.getByTestId("morning-brief-lines")).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items[0]).toHaveAttribute("data-tone", "good");
    expect(items[0]).toHaveTextContent("Readiness78% · Green · +16 vs 7-day avg 62%");
    expect(screen.getByText("Morning brief · Fri, Nov 27", { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows the freshness banner and per-line notes when data is stale", () => {
    render(
      <MorningBriefCard
        brief={{
          ...okBrief,
          anchorDate: "2026-11-25",
          latestDataDate: "2026-11-25",
          lines: [
            { ...okBrief.lines[0], note: "No scored recovery yet today — latest is Wed, Nov 25" },
            ...okBrief.lines.slice(1),
          ],
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("2 days ago");
    expect(screen.getByText("No scored recovery yet today — latest is Wed, Nov 25")).toBeInTheDocument();
  });

  it("renders the first-day empty state", () => {
    render(
      <MorningBriefCard
        brief={{
          today: "2026-11-27",
          status: "empty",
          anchorDate: "2026-11-27",
          latestDataDate: null,
          lines: [{ key: "suggestion", label: "Next", text: "No scored data yet", tone: "neutral", note: null }],
        }}
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("No scored data yet")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
