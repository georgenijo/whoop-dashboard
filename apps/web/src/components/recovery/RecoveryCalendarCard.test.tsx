import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import RecoveryCalendarCard from "./RecoveryCalendarCard";
import { addDays, buildRecoveryCalendar, type CalendarInputRow } from "@/lib/analytics/recoveryCalendar";

const TODAY = "2026-11-27";

function run(end: string, n: number, score: number): CalendarInputRow[] {
  return Array.from({ length: n }, (_, i) => ({
    date: addDays(end, -(n - 1 - i)),
    recovery_score: score,
    hrv: 60,
    rhr: 50,
  }));
}

describe("RecoveryCalendarCard", () => {
  afterEach(cleanup);

  it("empty data: renders the empty state and no grid", () => {
    render(<RecoveryCalendarCard calendar={buildRecoveryCalendar([], TODAY)} />);
    expect(screen.getByText("No scored recovery in the last 12 months")).toBeInTheDocument();
    expect(screen.queryByTestId("recovery-calendar-grid")).toBeNull();
  });

  it("renders a role=img grid with an accessible summary and per-cell tooltips", () => {
    const cal = buildRecoveryCalendar(
      [...run("2026-06-10", 10, 80), ...run("2026-07-10", 10, 25), ...run(TODAY, 3, 70)],
      TODAY,
    );
    render(<RecoveryCalendarCard calendar={cal} />);
    const grid = screen.getByRole("img");
    expect(grid.getAttribute("aria-label")).toContain("23 of 365 days scored");
    expect(grid.getAttribute("aria-label")).toContain("best month Jun 2026");

    const cells = grid.querySelectorAll("span[data-date]");
    expect(cells).toHaveLength(53 * 7);
    const today = grid.querySelector(`[data-date="${TODAY}"]`)!;
    expect(today.getAttribute("title")).toBe("Fri, Nov 27, 2026: recovery 70% (High) · HRV 60 ms · RHR 50 bpm");
    expect(today.getAttribute("data-band")).toBe("high");
    expect(grid.querySelector('[data-date="2026-07-10"]')!.getAttribute("data-band")).toBe("low");
    expect(grid.querySelector('[data-date="2026-08-10"]')!.getAttribute("data-band")).toBe("none");
    // Padding after today has no tooltip.
    const pad = grid.querySelector('[data-date="2026-11-28"]')!;
    expect(pad.getAttribute("data-band")).toBe("outside");
    expect(pad.hasAttribute("title")).toBe(false);
  });

  it("shows legend with text labels, streaks, best/worst month and coverage", () => {
    const cal = buildRecoveryCalendar(
      [...run("2026-06-10", 10, 80), ...run("2026-07-10", 10, 25), ...run(TODAY, 3, 70)],
      TODAY,
    );
    render(<RecoveryCalendarCard calendar={cal} />);
    const legend = screen.getByTestId("recovery-calendar-legend");
    expect(legend).toHaveTextContent("No data");
    expect(legend).toHaveTextContent("High ≥67% · 13");
    expect(legend).toHaveTextContent("Low <34% · 10");
    const stats = screen.getByTestId("recovery-calendar-stats");
    expect(stats).toHaveTextContent("Current green streak3 days (Nov 25–Nov 27)");
    expect(stats).toHaveTextContent("Longest green streak10 days (Jun 1–Jun 10)");
    expect(stats).toHaveTextContent("Best monthJun 2026 · avg 80%");
    expect(stats).toHaveTextContent("Worst monthJul 2026 · avg 25%");
    expect(stats).toHaveTextContent("Days scored23 of 365 (6%)");
  });

  it("includes numeric text-alternative tables for screen readers", () => {
    const cal = buildRecoveryCalendar(run(TODAY, 2, 50), TODAY);
    render(<RecoveryCalendarCard calendar={cal} />);
    const months = screen.getByTestId("recovery-calendar-months");
    expect(months.closest(".sr-only")).not.toBeNull();
    expect(within(months).getByRole("rowheader", { name: "Nov 2026" }).closest("tr")).toHaveTextContent("Nov 20262 of 2750020");
    const days = within(screen.getByTestId("recovery-calendar-days")).getAllByRole("row");
    expect(days).toHaveLength(3); // header + 2 scored days
    expect(days[2]).toHaveTextContent(`${TODAY}50Mid6050`);
  });

  it("single qualifying month shows a dash for worst month", () => {
    render(<RecoveryCalendarCard calendar={buildRecoveryCalendar(run(TODAY, 8, 90), TODAY)} />);
    expect(screen.getByTestId("recovery-calendar-stats")).toHaveTextContent("Worst month—");
  });
});
