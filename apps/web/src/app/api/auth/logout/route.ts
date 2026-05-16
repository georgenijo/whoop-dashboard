import { NextResponse, type NextRequest } from "next/server";
import {
  APPLE_OAUTH_STATE_COOKIE,
  COACH_SESSION_COOKIE,
} from "@/lib/auth/cookies";
import { publicOrigin } from "@/lib/auth/origin";

export const dynamic = "force-dynamic";

/**
 * Sign out: clear the `__Host-coach_session` cookie and bounce to /signin.
 *
 * POST-only by design. A GET handler would let any cross-origin `<img>` /
 * link prefetch / drive-by request log the user out (CSRF). Convention
 * elsewhere in this app: mutating actions are POST. Callers use a form
 * with `method="post"` (see /settings Sign-out button).
 *
 * Also clears `apple_oauth_state`. If a previous SIWA round-trip wrote a
 * cookie that later fails to decode (encoding-key rotation, signing-format
 * drift), a stale value left behind across sign-out can collide with the
 * fresh one written by `/start` on the next attempt — one of the suspected
 * triggers for #304 `state_cookie_missing` flakes.
 */

export function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/signin", publicOrigin(req)), {
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
  // Match the attributes used in `apple-web/start/route.ts` so the browser
  // expires the matching cookie. `__Host-` prefix is NOT used on this one
  // (see cookies.ts) because it has to ride Apple's cross-site POST.
  res.cookies.set({
    name: APPLE_OAUTH_STATE_COOKIE,
    value: "",
    httpOnly: true,
    secure: true,
    sameSite: "none",
    path: "/",
    maxAge: 0,
  });
  return res;
}
