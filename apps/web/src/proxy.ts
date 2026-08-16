import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COACH_SESSION_COOKIE } from "@/lib/auth/cookies";
import { publicOrigin } from "@/lib/auth/origin";
import { buildReportOnlyCsp, generateNonce } from "@/lib/security-headers";

const PUBLIC_FILE = /\.[^/]+$/;
const SENSITIVE_QUERY_KEY = /token|secret|code|state|key|password|auth/i;

/**
 * Routes that must remain reachable WITHOUT a session cookie:
 *   - `/signin`      — the sign-in page itself.
 *   - `/api/auth/*`  — Apple round-trip, Whoop OAuth, logout, token endpoints.
 *   - `/api/whoop/webhook` — HMAC-only path, no cookie ever attaches.
 *   - `/api/admin/*` — admin uses its own bearer-only auth.
 *   - `/_next/*`, `/favicon.ico` — Next.js plumbing + static.
 *
 * The matcher already drops most static traffic; this list is what the
 * AUTH GATE checks at runtime, after the matcher passes.
 *
 * Exact-match prefixes here MUST be the canonical (no trailing slash) form.
 * `isAuthExempt` normalises a single trailing slash off the request path
 * before comparison so `/api/whoop/webhook/` is treated identically to
 * `/api/whoop/webhook`.
 */
const AUTH_EXEMPT_PREFIXES: readonly string[] = [
  "/signin",
  "/api/auth/",
  "/api/whoop/webhook",
  "/api/admin/",
  // Build identity only (commit sha + build time, no user data, no secrets).
  // Must be reachable without a session so a deploy can verify which build is
  // live before anyone signs in.
  "/api/health",
];

function isAuthExempt(pathname: string): boolean {
  // Drop one trailing slash (but never collapse `/` itself). Apple POSTs to
  // the exact callback URL we hand it, but Whoop's webhook + future
  // partners may add a trailing slash unprompted, and Next.js does not
  // canonicalise on the proxy hop.
  const normalised =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  for (const prefix of AUTH_EXEMPT_PREFIXES) {
    if (normalised === prefix) return true;
    if (prefix.endsWith("/") && normalised.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Apply the SIWA auth gate. Returns a redirect Response when the request
 * should be bounced to /signin; returns null to let the request through.
 *
 * SHIPS DORMANT: when `APPLE_SERVICES_ID` is unset, the gate is a no-op.
 * That is the parallel-safety guarantee — the Services ID is registered
 * with Apple in parallel to this code landing, and we don't want a
 * half-configured deploy to lock everyone out.
 */
function authGate(req: NextRequest): NextResponse | null {
  if (!process.env.APPLE_SERVICES_ID) return null;
  const pathname = req.nextUrl.pathname;
  if (isAuthExempt(pathname)) return null;
  const cookie = req.cookies.get(COACH_SESSION_COOKIE);
  if (cookie?.value) return null;
  // iOS authenticates via Authorization: Bearer, no cookie. Let the request
  // through here; requireAuth re-verifies inside the route. Without this,
  // every iOS API call gets a 307 to /signin (HTML) and the app fails.
  const authz = req.headers.get("authorization");
  if (authz && /^Bearer\s+\S/i.test(authz)) return null;
  // /api/* callers (curl, fetch, future webhooks, server-to-server) can't
  // parse a /signin HTML redirect. Refuse with JSON 401 so they get a clear
  // error instead of opaque HTML. Page routes still 307 — browsers follow
  // it to the sign-in page.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL("/signin", publicOrigin(req));
  if (pathname && pathname !== "/") {
    url.searchParams.set("from", pathname);
  }
  return NextResponse.redirect(url, { status: 307 });
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function shouldLogRoute(pathname: string, method: string): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/_next/")) return false;
  if (pathname === "/favicon.ico") return false;
  if (PUBLIC_FILE.test(pathname)) return false;
  return true;
}

function isNextInternalRequest(req: NextRequest): boolean {
  return (
    req.headers.get("rsc") === "1" ||
    req.headers.has("next-router-prefetch") ||
    req.headers.has("next-router-segment-prefetch") ||
    req.nextUrl.searchParams.has("_rsc")
  );
}

function sanitizedSearch(params: URLSearchParams): string {
  const safeParams = new URLSearchParams(params);
  for (const key of Array.from(safeParams.keys())) {
    if (SENSITIVE_QUERY_KEY.test(key)) {
      safeParams.set(key, "redacted");
    }
  }
  const query = safeParams.toString();
  return query ? truncate(`?${query}`, 500) : "";
}

function userAgentClass(ua: string): string {
  const lower = ua.toLowerCase();
  if (!lower) return "unknown";
  if (/bot|crawler|spider|slurp|bingpreview/.test(lower)) return "bot";
  if (/ipad|tablet|android(?!.*mobile)/.test(lower)) return "tablet";
  if (/mobi|iphone|ipod|android.*mobile/.test(lower)) return "mobile";
  return "desktop";
}

function referrerDetails(req: NextRequest): {
  referrer: string | null;
  referrer_internal: boolean | null;
} {
  const value = req.headers.get("referer");
  if (!value) return { referrer: null, referrer_internal: null };

  try {
    const url = new URL(value);
    // Browsers send `Referer: https://coach.georgenijo.com/...` (public
    // origin), not the upstream listener. Compare against publicOrigin()
    // so same-origin referrers behind a proxy classify correctly.
    const internal = url.origin === publicOrigin(req);
    return {
      referrer: internal
        ? truncate(`${url.pathname}${sanitizedSearch(url.searchParams)}`, 500)
        : truncate(`${url.origin}${url.pathname}`, 500),
      referrer_internal: internal,
    };
  } catch {
    return {
      referrer: truncate(value, 500),
      referrer_internal: null,
    };
  }
}

/**
 * Issue #501. The candidate Content-Security-Policy ships REPORT-ONLY; the
 * enforcing floor (frame-ancestors, object-src, base-uri, form-action) is set
 * statically in `next.config.ts`. See `src/lib/security-headers.ts` for the
 * rationale on every directive.
 *
 * It lives in the proxy rather than `next.config.ts` because the policy
 * carries a per-request nonce, and `headers()` in the config is evaluated
 * once at server start.
 */
const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

/**
 * Only responses a browser parses as a document need the policy. Skipping
 * `/api/*` also avoids minting a nonce (a CSPRNG call) on every XHR the
 * dashboard fires, which on the coach page is a lot of them.
 *
 * KNOWN GAP: `/_not-found` is not, and cannot cleanly be, excluded here. This
 * middleware runs on the ORIGINAL requested pathname before Next decides the
 * route doesn't exist — by the time the 404 is known, this function has
 * already returned. There's also no single `app/not-found.tsx` to force
 * dynamic instead: this app has three separate route-group root layouts
 * ((auth)/(dashboard)/(onboarding), no top-level `app/layout.tsx`), so Next
 * falls back to its own built-in `global-not-found` component, which is
 * static-prerendered (confirmed via `npm run build`: `/_not-found` is the
 * only `○` route, everything else is `ƒ`). Overriding that would mean
 * opting into the `experimental.globalNotFound` flag and hand-building a
 * full `<html>/<body>` shell that duplicates every root layout's fonts and
 * globals — real risk for a single-box prod deploy with no staging tier, to
 * fix a cosmetic console warning.
 *
 * Net effect: every authenticated 404 gets a nonce-bearing
 * Content-Security-Policy-Report-Only header (from this function returning
 * true), but the prerendered `/_not-found` HTML has no nonce on its inline
 * bootstrap scripts, so Chrome logs spurious `script-src` report-only
 * violations for that one page. `ClientLogBootstrap` never mounts on this
 * page (it lives in `(dashboard)/layout.tsx`, and `/_not-found` uses none of
 * the app's layouts), so these never reach `client_logs` — they are
 * browser-console-only noise today.
 *
 * THIS BECOMES REAL AT FLIP TIME: when the candidate policy in
 * `security-headers.ts` moves from report-only to enforcing, `/_not-found`'s
 * own scripts will actually be blocked, breaking the 404 page's hydration
 * (the page text still renders — it's SSR'd HTML — but nothing interactive
 * on it will work). Re-check this comment before flipping; either accept a
 * broken-but-legible 404 page or solve it properly at that point.
 */
function needsCsp(pathname: string): boolean {
  return pathname !== "/api" && !pathname.startsWith("/api/");
}

function withCsp(res: NextResponse, csp: string | null): NextResponse {
  if (csp) res.headers.set(CSP_REPORT_ONLY_HEADER, csp);
  return res;
}

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const csp = needsCsp(pathname)
    ? buildReportOnlyCsp(
        generateNonce(),
        process.env.NODE_ENV === "development",
      )
    : null;

  // Auth gate runs BEFORE logging — there's no value in logging requests
  // that get redirected to /signin. Logger still attaches headers to the
  // genuine request below.
  const gate = authGate(req);
  if (gate) return withCsp(gate, csp);

  const ts = new Date().toISOString();
  const rawUa = req.headers.get("user-agent") ?? "";
  const ua = rawUa.slice(0, 60);
  const requestHeaders = new Headers(req.headers);

  console.log(`[req] ${ts} ${req.method} ${pathname}${req.nextUrl.search} ua="${ua}"`);

  requestHeaders.delete("x-whoop-route-log-route");
  requestHeaders.delete("x-whoop-route-log-started-at");
  requestHeaders.delete("x-whoop-route-log-start-ms");
  requestHeaders.delete("x-whoop-route-log-details");

  // Next.js parses the nonce back out of this REQUEST header and stamps it
  // onto every script tag it emits (verified in Next 16.2.4:
  // `app-render.js` reads `content-security-policy` OR
  // `content-security-policy-report-only`). Without this the response header
  // would advertise a policy that Next's own bootstrap script violates.
  //
  // Unconditionally cleared first: a client-supplied policy header would
  // otherwise let a caller choose the nonce Next renders, which is the whole
  // ballgame. Same spoofing guard as the x-whoop-route-log-* headers above.
  requestHeaders.delete(CSP_REPORT_ONLY_HEADER);
  if (csp) requestHeaders.set(CSP_REPORT_ONLY_HEADER, csp);

  if (!shouldLogRoute(pathname, req.method) || isNextInternalRequest(req)) {
    return withCsp(
      NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      }),
      csp,
    );
  }

  requestHeaders.set("x-whoop-route-log-route", pathname);
  requestHeaders.set("x-whoop-route-log-started-at", ts);
  requestHeaders.set("x-whoop-route-log-start-ms", String(Date.now()));
  requestHeaders.set(
    "x-whoop-route-log-details",
    JSON.stringify({
      method: req.method,
      query_string: sanitizedSearch(req.nextUrl.searchParams),
      ...referrerDetails(req),
      user_agent_class: userAgentClass(rawUa),
      user_agent: truncate(rawUa, 240),
    })
  );

  return withCsp(
    NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    }),
    csp,
  );
}

export const config = {
  // Run on every path EXCEPT Next.js internals + favicon. We deliberately
  // include `/api/*` so the auth gate can apply to API routes too — the
  // exempt list inside `authGate` carves out the public ones (`/api/auth/*`,
  // `/api/whoop/webhook`, `/api/admin/*`).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
