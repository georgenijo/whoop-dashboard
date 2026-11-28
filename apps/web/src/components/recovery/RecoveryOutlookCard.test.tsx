import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import RecoveryOutlookCard from "./RecoveryOutlookCard";
import type { OutlookBand, RecoveryOutlook } from "@/lib/analytics/recoveryOutlook";

afterEach(cleanup);

const band = (over: Partial<OutlookBand> = {}): OutlookBand => ({
  low: 55, high: 72, median: 64, n: 23, basis: "cell", confidence: "high", ...over,
});

const ok = (over: Partial<Extract<RecoveryOutlook, { status: "ok" }>> = {}): RecoveryOutlook => ({
  status: "ok",
  today: "2026-11-27",
  targetDate: "2026-11-28",
  todayStrain: 11.4,
  strainBucket: "moderate",
  assumedSleep: "met",
  headline: band(),
  scenarios: [
    { sleep: "short", label: "Under 70% of sleep need", band: band({ low: 31, high: 48, median: 40, n: 6, basis: "sleep", confidence: "low" }) },
    { sleep: "fair", label: "70–84% of sleep need", band: band({ low: 44, high: 61, median: 52, n: 12, confidence: "medium" }) },
    { sleep: "met", label: "85%+ of sleep need", band: band() },
  ],
  levers: [
    { key: "sleep_hours", change: "+1 h of sleep tonight", points: 6, n: 84 },
    { key: "strain", change: "2 less strain today", points: 3, n: 86 },
  ],
  scoredDays: 86,
  start: "2026-08-30",
  end: "2026-11-27",
  ...over,
});

describe("RecoveryOutlookCard", () => {
  it("shows a not-enough-data state for sparse history", () => {
    render(<RecoveryOutlookCard outlook={{ status: "insufficient", scoredDays: 3, minDays: 14 }} />);
    expect(screen.getByText("Not enough data yet")).toBeTruthy();
    expect(screen.getByText(/3 of 14 scored recovery days/)).toBeTruthy();
    expect(screen.queryByTestId("outlook-range")).toBeNull();
  });

  it("renders band, confidence, n, scenarios, levers and the disclaimer", () => {
    render(<RecoveryOutlookCard outlook={ok()} />);
    expect(screen.getByTestId("outlook-range").textContent).toBe("55–72%");
    expect(screen.getByTestId("outlook-confidence").textContent).toBe("high confidence");
    expect(screen.getByText(/For Sat, Nov 28/)).toBeTruthy();
    const basis = screen.getByTestId("outlook-basis").textContent!;
    expect(basis).toContain("your usual sleep (85%+ of sleep need)");
    expect(basis).toContain("today's moderate strain so far (11.4)");
    expect(basis).toContain("Based on 23 days with similar sleep and strain");
    expect(screen.getAllByTestId("outlook-scenario")).toHaveLength(3);
    const levers = screen.getAllByTestId("outlook-lever").map((l) => l.textContent);
    expect(levers[0]).toContain("+1 h of sleep tonight");
    expect(levers[0]).toContain("typically +6 pts for you");
    expect(screen.getByTestId("outlook-disclaimer").textContent).toMatch(/Not a prediction of Whoop's score/);
    expect(screen.getByTestId("outlook-disclaimer").textContent).toMatch(/only on your own past days/);
  });

  it("explains the wide overall fallback and hides levers/strain when absent", () => {
    render(
      <RecoveryOutlookCard
        outlook={ok({
          todayStrain: null,
          strainBucket: null,
          assumedSleep: null,
          headline: band({ low: 30, high: 85, median: 58, n: 17, basis: "overall", confidence: "low" }),
          levers: [],
        })}
      />,
    );
    const basis = screen.getByTestId("outlook-basis").textContent!;
    expect(basis).not.toContain("Assuming");
    expect(basis).toContain("too few similar days, so the range is wider");
    expect(screen.getByTestId("outlook-confidence").textContent).toBe("low confidence");
    expect(screen.queryAllByTestId("outlook-lever")).toHaveLength(0);
    expect(screen.queryByText("Biggest levers")).toBeNull();
  });

  it("formats a negative lever with a minus sign", () => {
    render(<RecoveryOutlookCard outlook={ok({ levers: [{ key: "consistency", change: "+10 pts sleep consistency", points: -2, n: 40 }] })} />);
    expect(screen.getByTestId("outlook-lever").textContent).toContain("typically −2 pts for you");
  });
});
