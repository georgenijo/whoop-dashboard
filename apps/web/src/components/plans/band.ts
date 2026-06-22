// Recovery-band mapping shared across the Plans surface. Mirrors the v1 scope:
//   High >= 67  -> hard session     (teal / --success)
//   Mid 34-66   -> moderate         (amber / --warning)
//   Low < 34    -> mobility / rest   (red / --danger)
// Colors resolve to the app's real theme vars (theme.css), not the mock's.

import type { Intensity } from "@/lib/db";

export type Band = "high" | "mid" | "low";

export function recoveryBand(score: number): Band {
  if (score >= 67) return "high";
  if (score >= 34) return "mid";
  return "low";
}

export function bandColor(band: Band): string {
  switch (band) {
    case "high":
      return "var(--success)";
    case "mid":
      return "var(--warning)";
    case "low":
      return "var(--danger)";
  }
}

export function bandLabel(band: Band): string {
  switch (band) {
    case "high":
      return "High";
    case "mid":
      return "Mid";
    case "low":
      return "Low";
  }
}

/** One-line guidance per band — the v1 "recovery-aware" prescription. */
export function bandGuidance(band: Band): string {
  switch (band) {
    case "high":
      return "Green light — push a hard session today.";
    case "mid":
      return "Moderate day — train, but hold back the top-end load.";
    case "low":
      return "Recover — mobility, an easy walk, or rest.";
  }
}

/** Color for a plan day's authored intensity (independent of today's score). */
export function intensityColor(intensity: Intensity): string {
  switch (intensity) {
    case "hard":
      return "var(--success)";
    case "moderate":
      return "var(--warning)";
    case "reduced":
      return "var(--danger)";
    case "rest":
      return "var(--fg-3)";
  }
}

export function intensityLabel(intensity: Intensity): string {
  return intensity.charAt(0).toUpperCase() + intensity.slice(1);
}
