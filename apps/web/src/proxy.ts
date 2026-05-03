import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_FILE = /\.[^/]+$/;
const SENSITIVE_QUERY_KEY = /token|secret|code|state|key|password|auth/i;

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
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
