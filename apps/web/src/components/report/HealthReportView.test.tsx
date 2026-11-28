import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { computeHealthReport } from "@/lib/analytics/healthReport";
import HealthReportView from "./HealthReportView";

afterEach(cleanup);

const today = "2026-11-27";
const empty = { recovery: [], sleep: [], cycles: [], workouts: [] };

describe("HealthReportView", () => {
  it("empty period shows coverage 0/N and an empty state, no table", () => {
    render(<HealthReportView report={computeHealthReport({ today, days: 30, ...empty })} />);
    expect(screen.getByTestId("hr-coverage")).toHaveTextContent("0/30 days scored recovery");
    expect(screen.getByTestId("hr-empty")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByTestId("hr-range")).toHaveTextContent("Thu, Oct 29, 2026 – Fri, Nov 27, 2026");
  });

  it("renders metrics, 'No data' for null metrics, and hides skin temp when absent", () => {
    const report = computeHealthReport({
      today,
      days: 7,
      ...empty,
      recovery: [
        { date: "2026-11-26", recovery_score: 55, hrv: 48, rhr: 54, spo2: null, skin_temp: null },
        { date: "2026-11-27", recovery_score: 77, hrv: 62, rhr: 50, spo2: null, skin_temp: null },
      ],
    });
    render(<HealthReportView report={report} />);
    const row = screen.getByTestId("hr-metric-recovery");
    expect(row).toHaveTextContent("66%");
    expect(within(row).getByText("55%")).toBeInTheDocument();
    expect(screen.getByTestId("hr-metric-sleepHours")).toHaveTextContent("No data");
    expect(screen.queryByTestId("hr-metric-skinTemp")).toBeNull();
    expect(screen.queryByTestId("hr-skin-dev")).toBeNull();
    expect(screen.getByTestId("hr-notable")).toHaveTextContent("Worst recovery55% · Thu, Nov 26");
  });

  it("shows skin temp row and signed deviation when present", () => {
    const report = computeHealthReport({
      today,
      days: 7,
      ...empty,
      recovery: [
        { date: "2026-11-26", recovery_score: 50, hrv: 50, rhr: 50, spo2: null, skin_temp: 33.6 },
        { date: "2026-11-27", recovery_score: 50, hrv: 50, rhr: 50, spo2: null, skin_temp: 33.0 },
      ],
    });
    render(<HealthReportView report={report} />);
    expect(screen.getByTestId("hr-metric-skinTemp")).toHaveTextContent("33.3°C");
    expect(screen.getByTestId("hr-skin-dev")).toHaveTextContent("+0.3°C on Thu, Nov 26");
  });

  it("period picker marks the current period and links to the allowlisted values only", () => {
    render(<HealthReportView report={computeHealthReport({ today, days: 90, ...empty })} />);
    const links = within(screen.getByRole("navigation", { name: "Report period" })).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/report?days=7", "/report?days=30", "/report?days=90"]);
    expect(links[2]).toHaveAttribute("aria-current", "page");
  });

  it("print button calls window.print and the controls are print-hidden", () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    render(<HealthReportView report={computeHealthReport({ today, days: 30, ...empty })} />);
    const btn = screen.getByRole("button", { name: "Print / Save as PDF" });
    fireEvent.click(btn);
    expect(print).toHaveBeenCalledOnce();
    const actions = screen.getByTestId("hr-actions");
    expect(actions).toHaveClass("hr-no-print");
    expect(actions).toContainElement(btn);
    expect(screen.getByTestId("health-report")).toHaveClass("hr-report");
    vi.unstubAllGlobals();
  });
});

describe("report.css print stylesheet", () => {
  const css = readFileSync(path.resolve(__dirname, "../../styles/report.css"), "utf8");
  const print = css.slice(css.indexOf("@media print"));

  it("has a print block that hides chrome and the print-only-hidden class", () => {
    expect(css).toContain("@media print");
    for (const sel of [".sidebar", ".topbar", ".bottom-nav", ".hr-no-print"]) expect(print).toContain(sel);
    expect(print).toMatch(/display:\s*none\s*!important/);
  });

  it("prints black on white and avoids page breaks inside sections and rows", () => {
    expect(print).toMatch(/background:\s*#fff/);
    expect(print).toMatch(/color:\s*#000/);
    expect(print).toMatch(/break-inside:\s*avoid/);
  });

  it("scopes chrome hiding to pages containing the report", () => {
    expect(print).toMatch(/body:has\(\.hr-report\) \.sidebar/);
  });
});
