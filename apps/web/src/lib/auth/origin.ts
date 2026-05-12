import type { NextRequest } from "next/server";

/**
 * Canonical public origin for building redirect URLs (sign-out, OAuth
 * callbacks, etc).
 *
 * Behind an nginx reverse proxy, `req.nextUrl.origin` resolves to the
 * upstream listener (e.g. `https://localhost:8501`) because `nextUrl` is
 * derived from the listener / Host header, not from X-Forwarded-* headers.
 * Set `PUBLIC_ORIGIN` in production to the user-facing origin; dev falls
 * through to `req.nextUrl.origin`.
 *
 * Use this helper anywhere you build a `NextResponse.redirect` target. The
 * `no-restricted-syntax` lint rule (eslint.config.mjs) enforces this in
 * `src/app/api/**\/route.ts` and `src/proxy.ts`.
 */

let warnedMalformed = false;

export function publicOrigin(req: NextRequest): string {
  const env = process.env.PUBLIC_ORIGIN;
  if (env && env.trim()) {
    try {
      return new URL(env.trim()).origin;
    } catch {
      // Log once — silent fallthrough on a misconfigured deploy would keep
      // leaking the upstream origin with no signal. URL constructor fails
      // for missing scheme, protocol-relative input, etc.
      if (!warnedMalformed) {
        warnedMalformed = true;
        console.error(
          `[publicOrigin] PUBLIC_ORIGIN is set but not a valid URL: ${JSON.stringify(env)}. Falling back to request origin.`
        );
      }
    }
  }
  return req.nextUrl.origin;
}
