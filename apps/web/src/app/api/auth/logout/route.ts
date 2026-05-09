import { NextResponse, type NextRequest } from "next/server";
import { COACH_SESSION_COOKIE } from "@/lib/auth/cookies";

export const dynamic = "force-dynamic";

/**
 * Sign out: clear the `__Host-coach_session` cookie and bounce to /signin.
 *
 * Accepts both GET (so it can be a plain `<a href>`) and POST (for forms /
 * fetch with credentials). The session JWT is stateless — we don't need to
 * call back into the DB; clearing the cookie is enough.
 */

function clearAndRedirect(req: NextRequest, status: number): NextResponse {
  const res = NextResponse.redirect(new URL("/signin", req.nextUrl.origin), {
    status,
  });
  res.cookies.set({
    name: COACH_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export function GET(req: NextRequest) {
  return clearAndRedirect(req, 303);
}

export function POST(req: NextRequest) {
  return clearAndRedirect(req, 303);
}
