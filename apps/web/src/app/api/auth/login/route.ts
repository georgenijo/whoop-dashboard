import { NextResponse, type NextRequest } from "next/server";
import { buildAuthUrl, requireAuth } from "@/lib/auth";
import { encodeWhoopOAuthState } from "@/lib/whoop/oauth-state";

export const dynamic = "force-dynamic";

const STATE_COOKIE_NAME = "whoop_oauth_state";
// Pin to the callback path so the cookie only travels with the OAuth
// completion request — never on unrelated /api/auth/* hits.
const STATE_COOKIE_PATH = "/api/auth/callback";
// Match the encoded-state TTL so a stale cookie can't outlive its signed payload.
const STATE_COOKIE_MAX_AGE = 5 * 60;

/**
 * Start the Whoop OAuth flow for the signed-in user. Generates a signed
 * state nonce that carries `user_id` (verified at the callback against
 * both the cookie and the HMAC) so the callback knows which user's
 * integration row to write — replacing the legacy `DEFAULT_USER_ID=1`
 * assumption.
 */
export async function GET(req: NextRequest) {
  let userId: number;
  try {
    const { user } = await requireAuth(req);
    userId = user.id;
  } catch (err) {
    if (err instanceof Response) return err;
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let signedState: string;
  let url: string;
  try {
    signedState = encodeWhoopOAuthState({ user_id: userId });
    url = buildAuthUrl(signedState);
  } catch (err) {
    const message = err instanceof Error ? err.message : "OAuth configuration error";
    return new NextResponse(message, { status: 500 });
  }

  const response = NextResponse.redirect(url);
  // HttpOnly + SameSite=Lax so the cookie returns on the top-level
  // redirect from Whoop but isn't accessible to JS or leaked cross-site.
  // `secure` only outside dev so localhost (HTTP) still works.
  response.cookies.set({
    name: STATE_COOKIE_NAME,
    value: signedState,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: STATE_COOKIE_PATH,
    maxAge: STATE_COOKIE_MAX_AGE,
  });
  return response;
}
