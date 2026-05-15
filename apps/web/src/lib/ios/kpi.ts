import "server-only";
import { formatDelta, msToHoursNumber } from "@/lib/format";
import type { Overview } from "@/lib/db/summary";

export type KPIKey = "recovery" | "hrv" | "rhr" | "sleep" | "strain" | "spo2";

export type KPIDelta = { label: string; dir: "up" | "down" | "flat" };

export type KPITile = {
  key: KPIKey;
  label: string;
  value: number | null;
  unit: string;
  precision: number;
  delta: KPIDelta | null;
  href: "/recovery" | "/sleep" | "/strain";
  color_hex: string;
};

// formatDelta returns a string label and a direction. The web component
// always renders the delta tile (using "—" / "— baseline" placeholders when
// the comparison can't be made); the iOS shape uses `null` to signal
// "nothing to display" so the client can hide the row entirely. We treat the
// flat-with-em-dash output of formatDelta as null on the iOS side.
function shapeDelta(
  latest: number | null | undefined,
  previous: number | null | undefined,
  opts: { unit?: string; precision?: number; reverse?: boolean },
): KPIDelta | null {
  if (latest == null || previous == null) return null;
  const d = formatDelta(latest, previous, opts);
  if (d.label === "—") return null;
  return d;
}

/**
 * Build the 6 KPI tiles the overview/recovery/sleep/strain pages render via
 * `KPIStrip.tsx`. Order, labels, units, colors, and deltas mirror the web
 * component exactly so the iOS UI can render against a stable contract.
 *
 * `value` is the raw number (or null); the precision/unit/color fields let
 * the client format it however it wants. `delta.label` is pre-formatted as a
 * human string ("↑ 3 vs yesterday") so the iOS app doesn't reimplement the
 * arrow + reverse-better logic.
 */
export function buildKPITiles(overview: Overview): KPITile[] {
  const lr = overview.latestRecovery;
  const pr = overview.previousRecovery;
  const lc = overview.latestCycle;
  const pc = overview.previousCycle;
  const ls = overview.latestSleep;
  const ps = overview.previousSleep;

  const latestSleepHours = msToHoursNumber(ls?.in_bed_ms ?? null);
  const previousSleepHours = msToHoursNumber(ps?.in_bed_ms ?? null);

  return [
    {
      key: "recovery",
      label: "Recovery",
      value: lr?.recovery_score ?? null,
      unit: "%",
      precision: 0,
      delta: shapeDelta(lr?.recovery_score, pr?.recovery_score, {
        unit: "",
        precision: 0,
      }),
      href: "/recovery",
      color_hex: "#00d4aa",
    },
    {
      key: "hrv",
      label: "HRV",
      value: lr?.hrv ?? null,
      unit: "ms",
      precision: 0,
      delta: shapeDelta(lr?.hrv, pr?.hrv, { unit: " ms", precision: 0 }),
      href: "/recovery",
      color_hex: "#7b61ff",
    },
    {
      key: "rhr",
      label: "RHR",
      value: lr?.rhr ?? null,
      unit: "bpm",
      precision: 0,
      delta: shapeDelta(lr?.rhr, pr?.rhr, {
        unit: " bpm",
        precision: 0,
        reverse: true,
      }),
      href: "/recovery",
      color_hex: "#ff6b6b",
    },
    {
      key: "sleep",
      label: "Sleep",
      value: latestSleepHours,
      unit: "h",
      precision: 1,
      delta: shapeDelta(latestSleepHours, previousSleepHours, {
        unit: "h",
        precision: 1,
      }),
      href: "/sleep",
      color_hex: "#00d4aa",
    },
    {
      key: "strain",
      label: "Strain",
      value: lc?.strain ?? null,
      unit: "",
      precision: 1,
      delta: shapeDelta(lc?.strain, pc?.strain, { unit: "", precision: 1 }),
      href: "/strain",
      color_hex: "#ffaa00",
    },
    {
      key: "spo2",
      label: "SpO2",
      value: lr?.spo2 ?? null,
      unit: "%",
      precision: 1,
      delta: shapeDelta(lr?.spo2, pr?.spo2, { unit: "%", precision: 1 }),
      href: "/recovery",
      color_hex: "#00d4aa",
    },
  ];
}
