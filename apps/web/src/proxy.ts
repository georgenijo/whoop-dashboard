import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_FILE = /\.[^/]+$/;

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

export function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;
  const ts = new Date().toISOString();
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 60);

  console.log(`[req] ${ts} ${req.method} ${pathname}${req.nextUrl.search} ua="${ua}"`);

  if (!shouldLogRoute(pathname, req.method) || isNextInternalRequest(req)) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-whoop-route-log-route", pathname);
  requestHeaders.set("x-whoop-route-log-started-at", ts);
  requestHeaders.set("x-whoop-route-log-start-ms", String(Date.now()));

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
