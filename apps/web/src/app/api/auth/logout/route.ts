import { NextResponse, type NextRequest } from "next/server";
import { COACH_SESSION_COOKIE } from "@/lib/auth/cookies";

export const dynamic = "force-dynamic";

/**
 * Sign out: clear the `__Host-coach_session` cookie and bounce to /signin.
 *
 * POST-only by design. A GET handler would let any cross-origin `<img>` /
 * link prefetch / drive-by request log the user out (CSRF). Convention
 * elsewhere in this app: mutating actions are POST. Callers use a form
 * with `method="post"` (see /settings Sign-out button).
 */

export function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/signin", req.nextUrl.origin), {
    status: 303,
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
