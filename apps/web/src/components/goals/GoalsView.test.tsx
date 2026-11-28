import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { GOALS_STORAGE_KEY, addDays, type GoalDayRow } from "@/lib/analytics/goals";
import GoalsView, { __resetGoalsStoreForTests } from "./GoalsView";

const TODAY = "2026-11-28"; // Saturday; current week Mon Nov 23 – today

function row(date: string, over: Partial<GoalDayRow> = {}): GoalDayRow {
  return {
    date,
    recovery_score: 75,
    resting_hr: 54,
    sleep_hours: 7.9,
    sleep_performance: 88,
    day_strain: 12,
    workouts_count: 1,
    ...over,
  };
}

/** Four full weeks + this week, every day meeting the default goals. */
function goodRows(): GoalDayRow[] {
  const out: GoalDayRow[] = [];
  for (let d = "2026-10-26"; d <= TODAY; d = addDays(d, 1)) out.push(row(d));
  return out;
}

beforeEach(() => {
  window.localStorage.clear();
  __resetGoalsStoreForTests();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function card(kind: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-goal="${kind}"]`);
  if (!el) throw new Error(`no card ${kind}`);
  return el;
}

describe("GoalsView", () => {
  it("server render shows a loading state and never touches storage", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem");
    const html = renderToString(<GoalsView rows={goodRows()} today={TODAY} weekStart={1} />);
    expect(html).toContain("Loading your goals");
    expect(spy).not.toHaveBeenCalled();
  });

  it("renders the default goals with status, ring, streaks and week history", () => {
    render(<GoalsView rows={goodRows()} today={TODAY} weekStart={1} />);
    expect(document.querySelectorAll("[data-goal]")).toHaveLength(4);
    const sleep = card("sleepHours");
    expect(within(sleep).getByText("On track")).toBeTruthy();
    expect(within(sleep).getByRole("img", { name: "Average sleep: 100% of target" })).toBeTruthy();
    expect(within(sleep).getByText("7h 54m average over 6 days")).toBeTruthy();
    // Four completed weeks met; the current average week isn't final yet.
    expect(within(sleep).getByText("Current streak").nextElementSibling?.textContent).toBe("4 weeks");
    const workouts = card("workouts");
    expect(within(workouts).getByText("Met")).toBeTruthy();
    expect(within(workouts).getByText("Current streak").nextElementSibling?.textContent).toBe("5 weeks");
    expect(within(workouts).getByRole("list", { name: "Workouts, week by week" }).children.length).toBeGreaterThan(4);
    expect(screen.getByTestId("goals-summary").textContent).toBe("This week: 2 met · 2 on track · 0 behind");
    expect(screen.getByText(/Weeks run Monday to Sunday/)).toBeTruthy();
  });

  it("empty data: says so and every goal waits for data", () => {
    render(<GoalsView rows={[]} today={TODAY} weekStart={1} />);
    expect(screen.getByText(/No Whoop data in the last 90 days/)).toBeTruthy();
    for (const el of document.querySelectorAll("[data-goal]")) {
      expect(el.getAttribute("data-status")).toBe("noData");
    }
    expect(screen.getByTestId("goals-summary").textContent).toContain("4 waiting for data");
  });

  it("reads saved goals and falls back to defaults on corrupt storage", () => {
    window.localStorage.setItem(
      GOALS_STORAGE_KEY,
      JSON.stringify({ version: 1, goals: { restingHr: { enabled: true, target: 50 }, workouts: { enabled: false, target: 3 } } }),
    );
    const { unmount } = render(<GoalsView rows={goodRows()} today={TODAY} weekStart={1} />);
    expect(document.querySelector('[data-goal="restingHr"]')).not.toBeNull();
    expect(document.querySelector('[data-goal="workouts"]')).toBeNull();
    expect(within(card("restingHr")).getByText("Behind")).toBeTruthy(); // 54 bpm vs ≤50
    unmount();
    window.localStorage.setItem(GOALS_STORAGE_KEY, "{not json");
    render(<GoalsView rows={goodRows()} today={TODAY} weekStart={1} />);
    expect(document.querySelectorAll("[data-goal]")).toHaveLength(4);
  });

  it("validates the form, then saves to localStorage only", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<GoalsView rows={goodRows()} today={TODAY} weekStart={1} />);
    const input = screen.getByLabelText("Workouts a week") as HTMLInputElement;
    expect(input.min).toBe("1");
    expect(input.max).toBe("14");
    fireEvent.change(input, { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Save goals" }));
    expect(screen.getByRole("alert").textContent).toContain("highlighted field");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter a whole number from 1 to 14.")).toBeTruthy();
    expect(window.localStorage.getItem(GOALS_STORAGE_KEY)).toBeNull();

    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.click(screen.getByLabelText("Resting heart rate"));
    fireEvent.click(screen.getByRole("button", { name: "Save goals" }));
    const saved = JSON.parse(window.localStorage.getItem(GOALS_STORAGE_KEY)!);
    expect(saved.version).toBe(1);
    expect(saved.goals.workouts).toEqual({ enabled: true, target: 5 });
    expect(saved.goals.restingHr.enabled).toBe(true);
    expect(screen.getByText("Goals saved.")).toBeTruthy();
    expect(within(card("workouts")).getByText("6 of 5 so far")).toBeTruthy();
    expect(within(card("restingHr")).getByText("On track")).toBeTruthy(); // 54 bpm vs ≤60
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reset clears the saved goals", () => {
    window.localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify({ version: 1, goals: { weeklyStrain: { enabled: true, target: 90 } } }));
    render(<GoalsView rows={goodRows()} today={TODAY} weekStart={1} />);
    expect(document.querySelector('[data-goal="weeklyStrain"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(window.localStorage.getItem(GOALS_STORAGE_KEY)).toBeNull();
    expect(document.querySelector('[data-goal="weeklyStrain"]')).toBeNull();
    expect((screen.getByLabelText("Total day strain a week") as HTMLInputElement).value).toBe("70");
  });

  it("keeps working for the visit when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    render(<GoalsView rows={goodRows()} today={TODAY} weekStart={1} />);
    expect(document.querySelectorAll("[data-goal]")).toHaveLength(4);
    act(() => {
      fireEvent.click(screen.getByLabelText("Weekly strain"));
      fireEvent.click(screen.getByRole("button", { name: "Save goals" }));
    });
    expect(screen.getByText(/Saved for this visit only/)).toBeTruthy();
    expect(document.querySelector('[data-goal="weeklyStrain"]')).not.toBeNull();
  });

  it("labels the week by the configured start day", () => {
    render(<GoalsView rows={goodRows()} today={TODAY} weekStart={0} />);
    expect(screen.getByText(/Weeks run Sunday to Saturday/)).toBeTruthy();
  });
});
