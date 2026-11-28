import "server-only";

/**
 * `SIMILAR_WORKOUTS=1` turns on the "Compare with similar workouts" card on
 * `/workouts/[id]` and the "vs usual" chip in the `/workouts` table. Anything
 * else (unset, "0", "true") is off: no extra reads, identical output.
 */
export function isSimilarWorkoutsEnabled(): boolean {
  return process.env.SIMILAR_WORKOUTS === "1";
}
