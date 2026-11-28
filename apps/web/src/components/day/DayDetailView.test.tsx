import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buildDayDetail, type DayDetailInput } from "@/lib/analytics/dayDetail";
import DayDetailView from "./DayDetailView";

const TODAY = "2026-11-28";

afterEach(cleanup);

function day(over: Partial<DayDetailInput> = {}) {
  return buildDayDetail({
    date: "2026-11-20",
    today: TODAY,
    tz: "UTC",
    recovery: null,
    sleep: null,
    naps: [],
    cycle: null,
    workouts: [],
    journal: [],
    datesWithData: [],
    ...over,
  });
}

const FULL: Partial<DayDetailInput> = {
  recovery: { date: "2026-11-20", recovery_score: 45, hrv: 48, rhr: 55, spo2: 96, skin_temp: 33.6 },
  sleep: {
    date: "2026-11-20", in_bed_ms: 27_000_000, light_ms: 12_600_000, deep_ms: 5_400_000, rem_ms: 5_400_000,
    awake_ms: 3_600_000, sleep_need_ms: 28_800_000, performance: 81, efficiency: 87, consistency: 70,
    disturbances: 9, respiratory_rate: 15.2, start_local: "2026-11-19T23:30:00", end_local: "2026-11-20T07:00:00",
  },
  cycle: { date: "2026-11-20", strain: 9.8, kilojoule: 8000, avg_hr: 68, max_hr: 160 },
  workouts: [
    { id: "w/1", date: "2026-11-20", sport: "Cycling", duration_sec: 3600, avg_hr: 140, max_hr: 170, strain: 9, kilojoule: 2500, distance_m: 30_000, start_utc: "2026-11-20T17:00:00Z" },
  ],
  journal: [{ date: "2026-11-20", title: "Tired", content: "Late dinner", mood: "meh", tags: "alcohol" }],
  datesWithData: ["2026-11-27", "2026-11-20", "2026-11-19"],
};

describe("DayDetailView", () => {
  it("renders every section for a full day", () => {
    render(<DayDetailView day={day(FULL)} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Friday, Nov 20, 2026");
    expect(screen.getByTestId("day-recap").textContent).toMatch(/^Yellow recovery at 45%/);

    const recovery = screen.getByRole("region", { name: "Recovery" });
    expect(within(recovery).getByText("45%")).toBeTruthy();
    expect(within(recovery).getByText("Yellow")).toBeTruthy();
    expect(within(recovery).getByText("48 ms")).toBeTruthy();
    expect(within(recovery).getByText("15.2 rpm")).toBeTruthy();
    expect(within(recovery).getByText("33.6 °C")).toBeTruthy();

    const sleep = screen.getByRole("region", { name: "Sleep" });
    expect(within(sleep).getByText("6h 30m")).toBeTruthy();
    expect(within(sleep).getByText(/11:30 PM → 7:00 AM/)).toBeTruthy();
    expect(within(sleep).getByRole("img", { name: "Sleep stages" }).children.length).toBe(4);

    const strain = screen.getByRole("region", { name: "Day strain" });
    expect(within(strain).getByText("9.8")).toBeTruthy();
    expect(within(strain).getByText("1,912 kcal")).toBeTruthy();

    const workouts = screen.getByRole("region", { name: "Workouts · 1" });
    const link = within(workouts).getByRole("link", { name: "Cycling" });
    expect(link.getAttribute("href")).toBe("/workouts/w%2F1");
    expect(within(workouts).getByText(/5:00 PM/)).toBeTruthy();
    expect(within(workouts).getByText(/30\.00 km/)).toBeTruthy();

    const journal = screen.getByRole("region", { name: "Journal" });
    expect(within(journal).getByText("Late dinner")).toBeTruthy();
    expect(within(journal).getByText("alcohol")).toBeTruthy();
  });

  it("prev/next links and picker limited to days with data", () => {
    render(<DayDetailView day={day(FULL)} />);
    expect(screen.getByRole("link", { name: /^Previous day/ }).getAttribute("href")).toBe("/day/2026-11-19");
    expect(screen.getByRole("link", { name: /^Next day/ }).getAttribute("href")).toBe("/day/2026-11-21");
    const select = screen.getByRole("combobox", { name: "Jump to a day with data" }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["2026-11-27", "2026-11-20", "2026-11-19"]);
    expect(select.value).toBe("2026-11-20");
    expect(select.form?.getAttribute("action")).toBe("/day");
    expect(select.form?.getAttribute("method")).toBe("get");
  });

  it("today: next is disabled, not a link", () => {
    render(<DayDetailView day={day({ ...FULL, date: TODAY })} />);
    expect(screen.queryByRole("link", { name: /^Next day/ })).toBeNull();
    expect(screen.getByLabelText("Next day (in the future)").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Today");
  });

  it("no-data day shows the empty state and nearest days with data", () => {
    render(<DayDetailView day={day({ date: "2026-11-23", datesWithData: ["2026-11-27", "2026-11-20"] })} />);
    expect(screen.getByText("No data for this day")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Recovery" })).toBeNull();
    expect(screen.getByRole("link", { name: /Nearest earlier/ }).getAttribute("href")).toBe("/day/2026-11-20");
    expect(screen.getByRole("link", { name: /Nearest later/ }).getAttribute("href")).toBe("/day/2026-11-27");
  });

  it("brand-new user: empty state, no picker, no nearest links", () => {
    render(<DayDetailView day={day()} />);
    expect(screen.getByText("No data for this day")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("link", { name: /Nearest/ })).toBeNull();
  });

  it("missing sections render their own empty lines; journal hidden when empty", () => {
    render(<DayDetailView day={day({ cycle: FULL.cycle! })} />);
    expect(screen.getByText("No recovery recorded.")).toBeTruthy();
    expect(screen.getByText("No sleep recorded.")).toBeTruthy();
    expect(screen.getByText("No workouts.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Journal" })).toBeNull();
  });
});
