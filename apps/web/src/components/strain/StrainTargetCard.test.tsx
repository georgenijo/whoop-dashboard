import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import StrainTargetCard from "./StrainTargetCard";
import { STRAIN_ZONES, type StrainTarget } from "@/lib/analytics/strainTarget";

const maintain = STRAIN_ZONES[1];
const ok: StrainTarget = {
  status: "ok",
  zone: maintain,
  low: maintain.low,
  high: maintain.high,
  reason: "Recovery 52% today — a normal training day.",
  recoveryDate: "2026-11-27",
  recoveryScore: 52,
  band: "mid",
  recoveryAgeDays: 0,
  cap: null,
  limitedHistory: false,
  avg7: 11.2,
  tsb: 0.4,
};

describe("StrainTargetCard", () => {
  afterEach(cleanup);

  it("renders the range, reason, disclaimer and in-range progress", () => {
    render(<StrainTargetCard target={ok} strainSoFar={9.5} strainSource="cycle" workoutCount={1} />);
    expect(screen.getByTestId("strain-target-range")).toHaveTextContent("8–12");
    expect(screen.getByText("Maintain")).toBeInTheDocument();
    expect(screen.getByTestId("strain-target-reason")).toHaveTextContent("Recovery 52% today");
    expect(screen.getByTestId("strain-so-far")).toHaveTextContent("9.5");
    expect(screen.getByText(/1 workout$/)).toBeInTheDocument();
    expect(screen.getByTestId("strain-progress")).toHaveTextContent("In the target range.");
    expect(screen.getByText(/not medical advice/)).toBeInTheDocument();
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "9.5");
    expect(meter).toHaveAttribute("aria-valuemax", "21");
    // Band spans 8/21 → 12/21 of the track.
    expect(screen.getByTestId("strain-target-band").style.left).toBe(`${(8 / 21) * 100}%`);
    expect(screen.getByTestId("strain-so-far-fill").style.width).toBe(`${(9.5 / 21) * 100}%`);
  });

  it("shows a lower-bound marker when strain comes from workouts", () => {
    render(<StrainTargetCard target={ok} strainSoFar={6} strainSource="workouts" workoutCount={2} />);
    expect(screen.getByTestId("strain-so-far")).toHaveTextContent("≥ 6.0");
    expect(screen.getByText(/2 workouts/)).toBeInTheDocument();
    expect(screen.getByTestId("strain-progress")).toHaveTextContent("Below target so far.");
  });

  it("handles no strain yet and clamps overshoot to the scale", () => {
    const { rerender } = render(
      <StrainTargetCard target={ok} strainSoFar={null} strainSource={null} workoutCount={0} />,
    );
    expect(screen.queryByTestId("strain-so-far-fill")).toBeNull();
    expect(screen.getByTestId("strain-progress")).toHaveTextContent("No strain recorded yet today.");
    rerender(<StrainTargetCard target={ok} strainSoFar={24} strainSource="cycle" workoutCount={3} />);
    expect(screen.getByTestId("strain-so-far-fill").style.width).toBe("100%");
    expect(screen.getByTestId("strain-progress")).toHaveTextContent("Above target");
  });

  it("labels a cap", () => {
    render(
      <StrainTargetCard
        target={{ ...ok, zone: STRAIN_ZONES[0], low: 4, high: 9, cap: "illness" }}
        strainSoFar={3}
        strainSource="cycle"
        workoutCount={0}
      />,
    );
    expect(screen.getByText(/illness cap/)).toBeInTheDocument();
    expect(screen.getByTestId("strain-target-range")).toHaveTextContent("4–9");
  });

  it("renders the unavailable state with the disclaimer and no meter", () => {
    render(
      <StrainTargetCard
        target={{ status: "unavailable", reason: "No scored recovery yet — wear your strap overnight to get a target." }}
        strainSoFar={5}
        strainSource="cycle"
        workoutCount={0}
      />,
    );
    expect(screen.getByText(/No scored recovery yet/)).toBeInTheDocument();
    expect(screen.queryByRole("meter")).toBeNull();
    expect(screen.getByText(/not medical advice/)).toBeInTheDocument();
  });
});
