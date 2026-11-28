import "server-only";

/**
 * `CHART_MARKERS=1` overlays workout / high-strain / journal / big-drop event
 * markers on the /recovery "Recovery score" and "HRV trend" charts. Anything
 * else (unset, "0", "true") is off: no workout or journal reads, and the charts
 * render byte-identical markup.
 */
export function isChartMarkersEnabled(): boolean {
  return process.env.CHART_MARKERS === "1";
}
