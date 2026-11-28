import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

afterEach(cleanup);

vi.mock("server-only", () => ({}));

import WeeklyReviewView from "./WeeklyReviewView";
import { addDays, computeWeeklyReview } from "@/lib/analytics/weekly";
import type { RecoveryRow } from "@/lib/db/recovery";

const TODAY = "2026-11-27";

function rec(date: string, score: number, hrv: number): RecoveryRow {
  return { date, recovery_score: score, hrv, rhr: 52, spo2: null, skin_temp: null };
}

function weeks(curDays: number, prevDays: number, curHrv = 58, prevHrv = 50) {
  const recovery: RecoveryRow[] = [];
  for (let i = 0; i < curDays; i++) recovery.push(rec(addDays(TODAY, -i), 60 + i, curHrv));
  for (let i = 7; i < 7 + prevDays; i++) recovery.push(rec(addDays(TODAY, -i), 60, prevHrv));
  return computeWeeklyReview({ today: TODAY, recovery, sleep: [], cycles: [], workouts: [] });
}

describe("WeeklyReviewView", () => {
  it("renders a full comparison with deltas, tones and highlights", () => {
    render(<WeeklyReviewView review={weeks(7, 7)} />);
    expect(screen.getByRole("heading", { name: "Weekly review" })).toBeInTheDocument();
    expect(screen.getByText(/Sat, Nov 21 – Fri, Nov 27/)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Change" })).toBeInTheDocument();

    const hrvRow = document.querySelector('[data-metric="hrv"]') as HTMLElement;
    expect(within(hrvRow).getByText("58 ms")).toBeInTheDocument();
    expect(within(hrvRow).getByText("50 ms")).toBeInTheDocument();
    const delta = hrvRow.querySelector(".wr-delta")!;
    expect(delta).toHaveTextContent("▲ +8 ms");
    expect(delta).toHaveClass("good");

    const rhrDelta = document.querySelector('[data-metric="rhr"] .wr-delta')!;
    expect(rhrDelta).toHaveTextContent("no real change");
    expect(rhrDelta).toHaveAttribute("data-direction", "flat");

    expect(screen.getByText("HRV is up 8 ms vs last week")).toBeInTheDocument();
    expect(screen.queryByTestId("weekly-not-comparable")).toBeNull();
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
  });

  it("shows only the current week when last week is too sparse", () => {
    render(<WeeklyReviewView review={weeks(5, 3)} />);
    const notice = screen.getByTestId("weekly-not-comparable");
    expect(notice).toHaveTextContent("at least 4 scored days");
    expect(notice).toHaveTextContent("this week: 5, last week: 3");
    expect(screen.queryByRole("columnheader", { name: "Change" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Last week" })).toBeNull();
    expect(screen.queryByText(/vs last week/)).toBeNull();
  });

  it("renders the empty state with no table", () => {
    render(<WeeklyReviewView review={weeks(0, 0)} />);
    expect(screen.getByTestId("weekly-empty")).toHaveTextContent("Not enough data");
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("renders dashes, not zeros, for missing metrics", () => {
    render(<WeeklyReviewView review={weeks(1, 0)} />);
    const sleepRow = document.querySelector('[data-metric="sleepHours"]') as HTMLElement;
    expect(sleepRow).toHaveTextContent("—");
    expect(sleepRow).not.toHaveTextContent("0h");
    expect(screen.getByText("Bed/wake spread needs at least 5 nights with times.")).toBeInTheDocument();
  });
});
