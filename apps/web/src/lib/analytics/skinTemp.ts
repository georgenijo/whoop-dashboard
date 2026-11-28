// Skin-temperature deviation rules shared by `SkinTempDeviationCard` (client)
// and the Health Alerts center (server). No `server-only` import on purpose:
// the card is a client component.

/** A day is "elevated" when skin temp exceeds the window mean by more than this (°C). */
export const SKIN_TEMP_ELEVATED_THRESHOLD = 0.5;

/**
 * Walk from the most recent row backwards and return the index bounds of the
 * latest run of consecutive elevated days, or null when no row is elevated. A
 * null `skin_temp` breaks a run. `runStart === runEnd` for a single day.
 */
export function latestElevatedSkinTempRun(
  rows: ReadonlyArray<{ skin_temp: number | null }>,
  mean: number,
): { runStart: number; runEnd: number } | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = rows[i].skin_temp;
    if (v != null && v - mean > SKIN_TEMP_ELEVATED_THRESHOLD) {
      let runStart = i;
      while (runStart - 1 >= 0) {
        const prev = rows[runStart - 1].skin_temp;
        if (prev != null && prev - mean > SKIN_TEMP_ELEVATED_THRESHOLD) runStart--;
        else break;
      }
      return { runStart, runEnd: i };
    }
  }
  return null;
}
