import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import WorkoutCalendarGrid from "./WorkoutCalendarGrid";
import { buildWorkoutCalendar } from "@/lib/analytics/workoutCalendar";

afterEach(() => {
  cleanup();
  push.mockReset();
});

const cal = buildWorkoutCalendar(
  [
    { id: "solo", date: "2026-10-14", sport: "Running", duration_sec: 3600, strain: 18.5, start_utc: null },
    { id: "a", date: "2026-10-15", sport: "Running", duration_sec: 1800, strain: 9, start_utc: "2026-10-15T10:00:00Z" },
    { id: "b", date: "2026-10-15", sport: "Yoga", duration_sec: 1200, strain: null, start_utc: "2026-10-15T18:00:00Z" },
  ],
  "2026-10",
  "2026-11-28",
  "UTC",
);

const cellFor = (date: string) => document.querySelector<HTMLElement>(`[data-date="${date}"]`)!;

describe("WorkoutCalendarGrid", () => {
  it("renders a grid with one roving tab stop and non-colour labels", () => {
    render(<WorkoutCalendarGrid weeks={cal.weeks} />);
    expect(screen.getByRole("grid", { name: "Workout calendar" })).toBeTruthy();
    expect(screen.getAllByRole("gridcell")).toHaveLength(35);
    expect(document.querySelectorAll('[data-date][tabindex="0"]')).toHaveLength(1);
    // First in-month day gets the tab stop when today is not in view.
    expect(cellFor("2026-10-01").tabIndex).toBe(0);
    const solo = cellFor("2026-10-14");
    expect(solo.tagName).toBe("A");
    expect(solo.getAttribute("href")).toBe("/workouts/solo");
    expect(solo.getAttribute("aria-label")).toContain("peak strain 18.5 (all out)");
    expect(solo.getAttribute("data-band")).toBe("allout");
    expect(solo.textContent).toContain("18.5");
    expect(solo.textContent).toContain("1h");
    expect(cellFor("2026-10-02").getAttribute("aria-label")).toBe("Fri, Oct 2: rest day");
  });

  it("arrow keys move focus by day and week; Home/End go to row edges", () => {
    render(<WorkoutCalendarGrid weeks={cal.weeks} />);
    const start = cellFor("2026-10-01"); // Thursday
    start.focus();
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cellFor("2026-10-02"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cellFor("2026-10-09"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cellFor("2026-10-01"));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(cellFor("2026-09-28"));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(cellFor("2026-10-04"));
    // Clamped at the grid edge.
    fireEvent.keyDown(document.activeElement!, { key: "Home", ctrlKey: true });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(cellFor("2026-09-28"));
    expect(cellFor("2026-09-28").tabIndex).toBe(0);
    expect(cellFor("2026-10-01").tabIndex).toBe(-1);
  });

  it("a multi-workout day opens a panel listing its sessions; Escape closes it", () => {
    render(<WorkoutCalendarGrid weeks={cal.weeks} />);
    const multi = cellFor("2026-10-15");
    expect(multi.tagName).toBe("BUTTON");
    expect(multi.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(multi);
    expect(multi.getAttribute("aria-expanded")).toBe("true");
    const panel = screen.getByTestId("workout-calendar-panel");
    const links = panel.querySelectorAll("a");
    expect([...links].map((a) => a.getAttribute("href"))).toEqual(["/workouts/a", "/workouts/b"]);
    expect(panel.textContent).toContain("Yoga");
    expect(panel.textContent).toContain("strain 9.0 · light");
    expect(panel.textContent).toContain("no strain");
    expect(push).not.toHaveBeenCalled();
    fireEvent.keyDown(multi, { key: "Escape" });
    expect(panel.querySelectorAll("a")).toHaveLength(0);
  });
});
