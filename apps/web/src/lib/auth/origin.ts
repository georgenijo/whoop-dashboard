import type { NextRequest } from "next/server";

/**
 * Canonical public origin for building redirect URLs (sign-out, OAuth
 * callbacks, etc).
 *
 * Behind nginx + Cloudflare Access, `req.nextUrl.origin` resolves to the
 * upstream listener (e.g. `https://localhost:8501`) because Next.js doesn't
 * trust `X-Forwarded-*` headers. Set `PUBLIC_ORIGIN` in production to the
 * user-facing origin; dev falls through to `req.nextUrl.origin`.
 *
 * Use this helper anywhere you build a `NextResponse.redirect` target. The
 * `no-restricted-syntax` lint rule (eslint.config.mjs) enforces this in
 * `src/app/api/**\/route.ts` and `src/proxy.ts`.
 */
export function publicOrigin(req: NextRequest): string {
  const env = process.env.PUBLIC_ORIGIN;
  if (env && env.trim()) {
    try {
      return new URL(env.trim()).origin;
    } catch {
      // Malformed env — fall through to request-derived origin. Logging
      // here would spam every request; rely on deploy-time validation.
    }
  }
  return req.nextUrl.origin;
}
