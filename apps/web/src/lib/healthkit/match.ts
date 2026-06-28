// Pure workout-matching helpers shared by the HealthKit ingest path
// (lib/healthkit/ingest.ts) and the Whoop upsert path (lib/whoop/upsert.ts).
// No imports — keeps both sides free of a circular dependency.

/** Match window: a workout within ±60s of an existing row's start is the same
 *  session (clock skew between Whoop's and Apple's record boundaries). */
export const MATCH_WINDOW_MS = 60_000;

/** SQL pre-filter window — wider than the exact JS check to absorb any ISO
 *  formatting differences between a stored `raw.start` and our bounds. */
export const SQL_WINDOW_MS = 5 * 60_000;

/** Whoop ("Soccer") and HealthKit ("soccer"/"football") differ in casing and a
 *  few synonyms — canonicalize known aliases so the same sport compares equal. */
const SPORT_ALIASES: Record<string, string> = {
  football: "soccer",
  soccer: "soccer",
  run: "running",
  running: "running",
  jog: "running",
  jogging: "running",
  ride: "cycling",
  bike: "cycling",
  biking: "cycling",
  cycling: "cycling",
  walk: "walking",
  walking: "walking",
  weightlifting: "weightlifting",
  weighttraining: "weightlifting",
  strengthtraining: "weightlifting",
  functionalstrengthtraining: "weightlifting",
};

export function canonSport(sport: string | null | undefined): string {
  const norm = (sport ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return SPORT_ALIASES[norm] ?? norm;
}

export function sportsCompatible(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ca = canonSport(a);
  const cb = canonSport(b);
  if (!ca || !cb) return false;
  return ca === cb;
}
