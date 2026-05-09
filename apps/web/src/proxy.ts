import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COACH_SESSION_COOKIE } from "@/lib/auth/cookies";

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
  const url = new URL("/signin", req.nextUrl.origin);
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
    const internal = url.origin === req.nextUrl.origin;
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

export function proxy(req: NextRequest) {
  // Auth gate runs BEFORE logging — there's no value in logging requests
  // that get redirected to /signin. Logger still attaches headers to the
  // genuine request below.
  const gate = authGate(req);
  if (gate) return gate;

  const pathname = req.nextUrl.pathname;
  const ts = new Date().toISOString();
  const rawUa = req.headers.get("user-agent") ?? "";
  const ua = rawUa.slice(0, 60);
  const requestHeaders = new Headers(req.headers);

  console.log(`[req] ${ts} ${req.method} ${pathname}${req.nextUrl.search} ua="${ua}"`);

  requestHeaders.delete("x-whoop-route-log-route");
  requestHeaders.delete("x-whoop-route-log-started-at");
  requestHeaders.delete("x-whoop-route-log-start-ms");
  requestHeaders.delete("x-whoop-route-log-details");

  if (!shouldLogRoute(pathname, req.method) || isNextInternalRequest(req)) {
    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
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

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  // Run on every path EXCEPT Next.js internals + favicon. We deliberately
  // include `/api/*` so the auth gate can apply to API routes too — the
  // exempt list inside `authGate` carves out the public ones (`/api/auth/*`,
  // `/api/whoop/webhook`, `/api/admin/*`).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
