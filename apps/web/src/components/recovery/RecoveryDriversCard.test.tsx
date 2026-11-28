import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import RecoveryDriversCard from "./RecoveryDriversCard";
import type { DriverFinding, RecoveryDriversResult } from "@/lib/analytics/recoveryDrivers";

afterEach(cleanup);

const finding = (over: Partial<DriverFinding> = {}): DriverFinding => ({
  key: "sleep_duration",
  label: "Sleep duration",
  status: "finding",
  summary: "Nights of 7.6 h or more average +9 recovery vs 6.4 h or less",
  effectPoints: 9.2,
  correlation: 0.48,
  strength: "moderate",
  n: 84,
  highMean: 68.1,
  lowMean: 58.9,
  highN: 28,
  lowN: 28,
  ...over,
});

describe("RecoveryDriversCard", () => {
  it("shows a friendly empty state below the minimum", () => {
    render(<RecoveryDriversCard result={{ status: "insufficient", pairedDays: 9, minDays: 21 }} />);
    expect(screen.getByText("Not enough data yet")).toBeTruthy();
    expect(screen.getByText(/9 of 21 scored recovery days/)).toBeTruthy();
    expect(screen.queryAllByTestId("driver-finding")).toHaveLength(0);
  });

  it("ranks findings with bars, lists the rest, and labels association not causation", () => {
    const result: RecoveryDriversResult = {
      status: "ok",
      pairedDays: 84,
      start: "2026-09-04",
      end: "2026-11-27",
      top: [
        finding(),
        finding({ key: "prior_strain", label: "Previous day's strain", correlation: -0.31, effectPoints: -7, summary: "Days after strain of 14.2 or more average −7 recovery vs 9.1 or less" }),
      ],
      others: [
        { key: "workout_day", label: "Workout vs rest day", status: "no_pattern", reason: "No clear pattern yet", n: 80 },
        { key: "deep_share", label: "Deep-sleep share", status: "insufficient", reason: "Only 12 of 21 days needed", n: 12 },
      ],
    };
    render(<RecoveryDriversCard result={result} />);
    const rows = screen.getAllByTestId("driver-finding");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Sleep duration");
    expect(rows[0].textContent).toContain("moderate · r +0.48 · 84 days");
    expect(rows[1].textContent).toContain("r −0.31");
    const bars = screen.getAllByTestId("driver-bar");
    expect(bars[0].style.width).toBe("80%");
    expect(bars[1].style.width).toBe("52%");
    const others = screen.getAllByTestId("driver-other");
    expect(others[0].textContent).toContain("No clear pattern");
    expect(others[1].textContent).toContain("Not enough data — only 12 of 21 days needed");
    expect(screen.getByText(/not causes/)).toBeTruthy();
  });

  it("says 'no clear pattern' when nothing clears the gate", () => {
    render(
      <RecoveryDriversCard
        result={{ status: "ok", pairedDays: 30, start: "2026-10-29", end: "2026-11-27", top: [], others: [] }}
      />,
    );
    expect(screen.getByText("No clear pattern yet")).toBeTruthy();
  });
});
