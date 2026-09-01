import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildKPITiles } from "./kpi";
import type { Overview } from "@/lib/db/summary";

const EMPTY_OVERVIEW: Overview = {
  latestRecovery: null,
  previousRecovery: null,
  latestCycle: null,
  previousCycle: null,
  latestSleep: null,
  previousSleep: null,
  recoveryTrend: [],
  strainTrend: [],
  sleepTrend: [],
  latestSteps: null,
  previousSteps: null,
  hasData: false,
};

function recoveryRow(date: string, score: number, hrv: number, rhr: number, spo2: number) {
  return { date, recovery_score: score, hrv, rhr, spo2, skin_temp: null };
}

function cycleRow(date: string, strain: number) {
  return { date, strain, kilojoule: null, avg_hr: null, max_hr: null };
}

function sleepRow(date: string, inBedMs: number) {
  return {
    date,
    in_bed_ms: inBedMs,
    light_ms: null,
    deep_ms: null,
    rem_ms: null,
    awake_ms: null,
    sleep_need_ms: null,
    performance: null,
    efficiency: null,
    consistency: null,
    disturbances: null,
    cycles: null,
    respiratory_rate: null,
    need_from_baseline_ms: null,
    need_from_debt_ms: null,
    need_from_strain_ms: null,
    need_from_nap_ms: null,
    start_local: null,
    end_local: null,
  };
}

describe("buildKPITiles", () => {
  it("returns 7 tiles in the expected order with expected labels", () => {
    const overview: Overview = {
      ...EMPTY_OVERVIEW,
      latestRecovery: recoveryRow("2026-05-10", 75, 60, 50, 97.5),
      previousRecovery: recoveryRow("2026-05-09", 70, 55, 52, 96.5),
      latestCycle: cycleRow("2026-05-10", 13.5),
      previousCycle: cycleRow("2026-05-09", 11.0),
      latestSleep: sleepRow("2026-05-10", 8 * 3_600_000),
      previousSleep: sleepRow("2026-05-09", 7 * 3_600_000),
      hasData: true,
    };
    const tiles = buildKPITiles(overview);
    expect(tiles).toHaveLength(7);
    expect(tiles.map((t) => t.key)).toEqual([
      "recovery",
      "hrv",
      "rhr",
      "sleep",
      "strain",
      "spo2",
      "steps",
    ]);
    expect(tiles.map((t) => t.label)).toEqual([
      "Recovery",
      "HRV",
      "RHR",
      "Sleep",
      "Strain",
      "SpO2",
      "Steps",
    ]);

    const recovery = tiles[0];
    expect(recovery.value).toBe(75);
    expect(recovery.unit).toBe("%");
    expect(recovery.color_hex).toBe("#00d4aa");
    expect(recovery.href).toBe("/recovery");
    expect(recovery.delta).not.toBeNull();
    expect(recovery.delta!.dir).toBe("up");

    const rhr = tiles[2];
    expect(rhr.value).toBe(50);
    // RHR is reverse=true — a drop from 52→50 is an improvement.
    expect(rhr.delta!.dir).toBe("up");

    const sleep = tiles[3];
    expect(sleep.value).toBe(8);
    expect(sleep.href).toBe("/sleep");

    const strain = tiles[4];
    expect(strain.value).toBe(13.5);
    expect(strain.href).toBe("/strain");
  });

  it("returns 7 tiles with null value + null delta when overview is empty", () => {
    const tiles = buildKPITiles(EMPTY_OVERVIEW);
    expect(tiles).toHaveLength(7);
    for (const t of tiles) {
      expect(t.value).toBeNull();
      expect(t.delta).toBeNull();
    }
    // Order + labels still preserved.
    expect(tiles.map((t) => t.key)).toEqual([
      "recovery",
      "hrv",
      "rhr",
      "sleep",
      "strain",
      "spo2",
      "steps",
    ]);
  });

  it("delta label says 'vs yesterday' when the rows are exactly 1 day apart", () => {
    const overview: Overview = {
      ...EMPTY_OVERVIEW,
      latestRecovery: recoveryRow("2026-05-10", 75, 60, 50, 97.5),
      previousRecovery: recoveryRow("2026-05-09", 70, 55, 52, 96.5),
      hasData: true,
    };
    const tiles = buildKPITiles(overview);
    expect(tiles[0].delta!.label).toContain("vs yesterday");
  });

  it("delta label says 'vs N days ago' when the rows have a gap", () => {
    const overview: Overview = {
      ...EMPTY_OVERVIEW,
      latestRecovery: recoveryRow("2026-05-15", 75, 60, 50, 97.5),
      previousRecovery: recoveryRow("2026-05-09", 70, 55, 52, 96.5),
      hasData: true,
    };
    const tiles = buildKPITiles(overview);
    expect(tiles[0].delta!.label).toContain("vs 6 days ago");
    expect(tiles[0].delta!.label).not.toContain("vs yesterday");
  });
});
