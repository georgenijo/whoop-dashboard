import crypto from "node:crypto";

/**
 * Constant-time bearer-secret compare. Mirrors the length-guard +
 * `crypto.timingSafeEqual` shape already used for Whoop webhook signatures
 * (`apps/web/src/lib/whoop/signature.ts`) rather than a plain `===`, which
 * short-circuits on the first mismatched byte and leaks timing information
 * about how much of the secret the caller got right.
 *
 * Lives outside the route module because a route file may only export
 * Next.js route fields (`next build --webpack` rejects any other export).
 * Exported for test coverage that proves the mismatch path actually calls
 * `crypto.timingSafeEqual` — i.e. it isn't secretly a plain `===` in
 * disguise. That test can't observe timing itself; it only proves the
 * primitive was used, which is the extent of what a unit test can show.
 */
export function secretMatches(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on unequal-length buffers rather than returning
  // false — guard it explicitly. This branch does leak the correct
  // secret's length, not its content, which is the same tradeoff every
  // constant-time-compare-of-strings implementation makes (see
  // signature.ts's identical guard).
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}
