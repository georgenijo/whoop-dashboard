import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import TonightSleepPlanCard from "./TonightSleepPlanCard";
import type { SleepPlanReady } from "@/lib/analytics/sleepPlan";

const H = 3_600_000;

function plan(over: Partial<SleepPlanReady> = {}): SleepPlanReady {
  return {
    status: "ready",
    nights: 14,
    wakeDate: "2026-11-21",
    wakeMin: 6 * 60 + 45,
    bedtimeMin: 22 * 60 + 30,
    bedtimeAfterMidnight: false,
    windDownMin: 21 * 60 + 45,
    timeInBedMs: 8.25 * H,
    yieldSleepMs: 7.5 * H,
    targetSleepMs: 7.5 * H,
    baselineNeedMs: 7 * H,
    needSource: "baseline",
    debtMs: 1.4 * H,
    paybackMs: 0.7 * H,
    efficiency: 0.91,
    irregular: false,
    wakeSpreadMin: 12,
    recoveryBedtimeMin: 22 * 60 + 45,
    dstShiftMin: 0,
    reason: "Carrying 1.4 h of sleep debt; your recovery is highest when you are in bed before 22:45",
    strip: [
      { date: "2026-11-14", bedDate: "2026-11-13", bedMin: 22 * 60 + 30, deltaMin: 0 },
      { date: "2026-11-15", bedDate: "2026-11-14", bedMin: 23 * 60 + 40, deltaMin: 70 },
      { date: "2026-11-16", bedDate: "2026-11-16", bedMin: 0 * 60 + 50, deltaMin: 140 },
      { date: "2026-11-17", bedDate: "2026-11-16", bedMin: 22 * 60 + 10, deltaMin: -20 },
    ],
    ...over,
  };
}

describe("TonightSleepPlanCard", () => {
  afterEach(cleanup);

  it("renders the plan: wind-down, bedtime, wake, yield and reason", () => {
    render(<TonightSleepPlanCard plan={plan()} />);
    expect(screen.getByText("Tonight")).toBeInTheDocument();
    expect(screen.getByTestId("plan-winddown")).toHaveTextContent("21:45");
    expect(screen.getByTestId("plan-bedtime")).toHaveTextContent("22:30");
    expect(screen.getByTestId("plan-wake")).toHaveTextContent("06:45");
    expect(screen.getByTestId("plan-yield")).toHaveTextContent("7h 30m");
    expect(screen.getByTestId("plan-reason")).toHaveTextContent(
      "Carrying 1.4 h of sleep debt; your recovery is highest when you are in bed before 22:45.",
    );
    expect(screen.getByText(/guidance only/)).toBeInTheDocument();
    expect(screen.queryByTestId("plan-irregular")).not.toBeInTheDocument();
  });

  it("renders the planned-vs-last-bedtimes strip with signed deltas and clamped dots", () => {
    render(<TonightSleepPlanCard plan={plan()} />);
    expect(screen.getByRole("img", { name: /Planned bedtime 22:30 compared with your last 4 bedtimes/ })).toBeInTheDocument();
    const dots = screen.getAllByTestId("bedtime-dot");
    expect(dots).toHaveLength(4);
    expect(dots[0].style.left).toBe("50%");
    expect(dots[2].style.left).toBe("96%"); // +140 min clamps to the +2h edge
    expect(dots[3].getAttribute("title")).toBe("Mon 22:10 · 20m earlier");
    const list = screen.getByRole("list");
    expect(within(list).getByText(/\+70m/)).toBeInTheDocument();
    expect(within(list).getByText(/−20m/)).toBeInTheDocument();
    expect(within(list).getByText(/±0m/)).toBeInTheDocument();
  });

  it("labels an after-midnight bedtime and shows the irregular hint", () => {
    render(
      <TonightSleepPlanCard
        plan={plan({ bedtimeMin: 30, bedtimeAfterMidnight: true, windDownMin: 23 * 60 + 45, irregular: true })}
      />,
    );
    expect(screen.getByText("In bed (after midnight)")).toBeInTheDocument();
    expect(screen.getByTestId("plan-bedtime")).toHaveTextContent("00:30");
    expect(screen.getByTestId("plan-irregular")).toHaveTextContent("Irregular schedule detected");
  });

  it("shows only a hint (no times) when there are fewer than 5 nights", () => {
    render(<TonightSleepPlanCard plan={{ status: "insufficient", nights: 2, needed: 5 }} />);
    expect(screen.getByText("Not enough nights for a plan yet")).toBeInTheDocument();
    expect(screen.getByText(/Logged 2 of 5 nights/)).toBeInTheDocument();
    expect(screen.queryByTestId("plan-bedtime")).not.toBeInTheDocument();
    expect(screen.queryByTestId("bedtime-dot")).not.toBeInTheDocument();
  });

  it("omits the strip when there are no recent bedtimes", () => {
    render(<TonightSleepPlanCard plan={plan({ strip: [] })} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
