import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildDataHealth,
  shiftIsoDate,
  windowDates,
  type DataHealthInput,
} from "@/lib/analytics/dataHealth";
import DataHealthView from "./DataHealthView";

const TODAY = "2026-11-27";

afterEach(cleanup);

function summary(over: Partial<DataHealthInput> = {}) {
  return buildDataHealth({
    today: TODAY,
    window: 30,
    recovery: [],
    sleeps: [],
    naps: [],
    cycles: [],
    workouts: [],
    syncLogs: [],
    ...over,
  });
}

function filled(skip: string[] = []): Partial<DataHealthInput> {
  const ds = windowDates(TODAY, 30).filter((d) => !skip.includes(d));
  return {
    recovery: ds.map((date) => ({ date, recovery_score: 60, hrv: 70, rhr: 50, spo2: null, skin_temp: 33.2 })),
    sleeps: ds.map((date) => ({
      date,
      in_bed_ms: 28_800_000,
      respiratory_rate: 15,
      start_local: `${shiftIsoDate(date, -1)}T23:00:00`,
      end_local: `${date}T07:00:00`,
    })),
    cycles: ds.map((date) => ({ date, strain: 11 })),
    workouts: [{ date: "2026-11-25" }],
  };
}

describe("DataHealthView", () => {
  it("empty: explains there is no data, no sync history", () => {
    render(<DataHealthView summary={summary()} tz="UTC" />);
    expect(screen.getByText("No Whoop data in this window")).toBeTruthy();
    expect(screen.getByTestId("overall-pct").textContent).toBe("0%");
    expect(screen.getByText("No sync history recorded.")).toBeTruthy();
    expect(screen.getByText("No duplicate or overlapping sleeps in this window.")).toBeTruthy();
  });

  it("full: one cell per day per metric, 100%, no gap explanations", () => {
    render(<DataHealthView summary={summary(filled())} tz="UTC" />);
    const row = screen.getByTestId("metric-recovery");
    expect(row.querySelectorAll("[data-state]")).toHaveLength(30);
    expect(within(row).getByText("100%")).toBeTruthy();
    expect(within(row).getByText("No gaps")).toBeTruthy();
    expect(screen.getByTestId("metric-spo2").getAttribute("data-status")).toBe("not-recorded");
    expect(screen.getByText(/every trend has full data/)).toBeTruthy();
    expect(screen.getByTestId("newest-data").textContent).toBe("Nov 27");
    // Window toggle marks the active window.
    expect(screen.getByRole("link", { name: "30 days" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "90 days" }).getAttribute("href")).toBe("/data-health?window=90");
  });

  it("gaps: longest gap, missing cells, and what they affect", () => {
    const skip = ["2026-11-10", "2026-11-11", "2026-11-12"];
    render(<DataHealthView summary={summary(filled(skip))} tz="UTC" />);
    const row = screen.getByTestId("metric-sleep");
    expect(within(row).getByText("Longest gap 3d · Nov 10–Nov 12")).toBeTruthy();
    expect(row.querySelectorAll('[data-state="missing"]')).toHaveLength(3);
    expect(within(row).getByText("90%")).toBeTruthy();
    const effects = screen.getByTestId("gap-effects");
    expect(within(effects).getByText(/sleep debt/)).toBeTruthy();
  });

  it("shows duplicate warnings, requirements and a failing sync source", () => {
    const base = filled();
    render(
      <DataHealthView
        tz="America/New_York"
        summary={summary({
          ...base,
          sleeps: [
            ...base.sleeps!,
            { date: "2026-11-20", in_bed_ms: 3_600_000, respiratory_rate: null, start_local: null, end_local: null },
          ],
          syncLogs: [{ started_at: "2026-11-27T14:00:00Z", status: "error", source: "manual", error_message: "Whoop 503" }],
          features: { sleepPlan: true },
        })}
      />,
    );
    const warnings = screen.getByTestId("warnings-card");
    expect(within(warnings).getByText("2 main sleeps on one day")).toBeTruthy();
    expect(within(warnings).getByText(/longest \(8h 00m\)/)).toBeTruthy();
    expect(within(screen.getByTestId("requirements")).getByText("Tonight's sleep plan")).toBeTruthy();
    const sync = screen.getByTestId("sync-card");
    expect(within(sync).getByText("Last attempt failed")).toBeTruthy();
    expect(within(sync).getByText(/failed Nov 27, 9:00 AM: Whoop 503/)).toBeTruthy();
  });
});
