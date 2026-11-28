import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import SimilarWorkoutsCard from "./SimilarWorkoutsCard";
import WorkoutsTable from "./WorkoutsTable";
import {
  compareSimilarWorkouts,
  computeVsUsualChips,
  type SimilarWorkoutInput,
} from "@/lib/analytics/similarWorkouts";
import type { WorkoutRow } from "@/lib/db";

function row(over: Partial<WorkoutRow>): WorkoutRow {
  return {
    id: "x",
    date: "2026-11-10",
    sport: "Running",
    duration_sec: 3600,
    avg_hr: 150,
    max_hr: 175,
    strain: 12,
    kilojoule: 2500,
    distance_m: 10_000,
    zone_0_ms: 0,
    zone_1_ms: 600_000,
    zone_2_ms: 1_200_000,
    zone_3_ms: 1_200_000,
    zone_4_ms: 480_000,
    zone_5_ms: 120_000,
    start_utc: null,
    end_utc: null,
    ...over,
  };
}

afterEach(cleanup);

const target: SimilarWorkoutInput = row({ id: "t", date: "2026-11-20", avg_hr: 160, strain: 14.2, distance_m: 11_000 });

describe("SimilarWorkoutsCard", () => {
  it("renders verdict, deltas, zone bars and links to the compared sessions", () => {
    const pool = [row({ id: "a", date: "2026-11-12" }), row({ id: "b", date: "2026-11-05", avg_hr: 148 })];
    render(<SimilarWorkoutsCard result={compareSimilarWorkouts(target, pool)} />);
    expect(screen.getByTestId("similar-verdict")).toHaveTextContent("Higher intensity than usual");
    expect(screen.getByText("vs last 2 Running sessions · ±25% length")).toBeInTheDocument();
    expect(screen.getByText("Tied for longest running this month")).toBeInTheDocument();
    expect(screen.getByText("+11")).toBeInTheDocument(); // avg HR 160 vs 149
    expect(screen.getByText("usual 149 bpm")).toBeInTheDocument();
    expect(screen.getByText("5:27/km")).toBeInTheDocument(); // 3600s / 11 km
    expect(screen.getAllByRole("img")).toHaveLength(2);
    const links = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(links).toEqual(["/workouts/a", "/workouts/b"]);
  });

  it("hides metric rows with no data on either side and shows 'same' for zero deltas", () => {
    const t = row({ id: "t", date: "2026-11-20", distance_m: null });
    render(<SimilarWorkoutsCard result={compareSimilarWorkouts(t, [row({ id: "a", distance_m: null })])} />);
    expect(screen.queryByText("Distance")).toBeNull();
    expect(screen.queryByText("Pace")).toBeNull();
    expect(screen.getAllByText("same").length).toBeGreaterThanOrEqual(3);
  });

  it("first session of a sport", () => {
    render(<SimilarWorkoutsCard result={compareSimilarWorkouts(row({ id: "t", sport: "Padel" }), [])} />);
    expect(screen.getByText("Your first Padel session in the past year")).toBeInTheDocument();
  });

  it("same sport but no similar length", () => {
    render(
      <SimilarWorkoutsCard result={compareSimilarWorkouts(target, [row({ id: "a", duration_sec: 900 })])} />,
    );
    expect(screen.getByText("No earlier Running sessions of a similar length")).toBeInTheDocument();
    expect(screen.getByText(/1 earlier Running session, none within ±25%/)).toBeInTheDocument();
  });

  it("too short and no duration", () => {
    const { unmount } = render(
      <SimilarWorkoutsCard result={compareSimilarWorkouts(row({ duration_sec: 120 }), [])} />,
    );
    expect(screen.getByText("Too short to compare")).toBeInTheDocument();
    unmount();
    render(<SimilarWorkoutsCard result={compareSimilarWorkouts(row({ duration_sec: null }), [])} />);
    expect(screen.getByText("No duration recorded")).toBeInTheDocument();
  });
});

describe("WorkoutsTable vs-usual chip", () => {
  const rows = [row({ id: "new", date: "2026-11-20", avg_hr: 140, strain: 8 }), row({ id: "old" })];

  it("renders no chip without the prop (flag off) — markup identical to before", () => {
    const { container: a } = render(<WorkoutsTable rows={rows} />);
    expect(screen.queryByTestId("vs-usual-chip")).toBeNull();
    const html = a.innerHTML;
    const { container: b } = render(<WorkoutsTable rows={rows} vsUsual={undefined} />);
    expect(b.innerHTML).toBe(html);
  });

  it("renders a chip only on rows with a comparison", () => {
    render(<WorkoutsTable rows={rows} vsUsual={computeVsUsualChips(rows)} />);
    const chips = screen.getAllByTestId("vs-usual-chip");
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent("↓ easier");
    expect(chips[0]).toHaveAttribute("title", "vs your last 1 similar session");
  });
});
