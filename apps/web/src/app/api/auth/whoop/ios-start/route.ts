import { NextResponse, type NextRequest } from "next/server";
import { buildAuthUrl, requireAuth } from "@/lib/auth";
import { encodeWhoopOAuthState } from "@/lib/whoop/oauth-state";

export const dynamic = "force-dynamic";

/**
 * iOS-only OAuth start.
 *
 * The web start route (/api/auth/login) returns a 302 + Set-Cookie that an
 * SFSafariViewController can't carry because it runs in an isolated cookie
 * jar with no path to the iOS app's Bearer token. ASWebAuthenticationSession
 * has the same isolation but DOES follow redirects within its own ephemeral
 * jar, so the trick is to hand it a pre-built authorize URL.
 *
 * Flow:
 *   1. iOS calls this endpoint over `APIClient` with its Bearer token.
 *   2. `requireAuth` resolves the user_id from the bearer.
 *   3. We mint a signed state with `flow: "ios"` (HMAC-protected, 5-min TTL).
 *   4. Return `{ authorize_url }` — iOS opens that in
 *      ASWebAuthenticationSession with callbackURLScheme="coach".
 *   5. Whoop redirects to /api/auth/callback?state=…&code=…
 *   6. Callback sees `flow=ios`, skips the cookie-pair check (no cookie jar),
 *      exchanges the code, and redirects to `coach://oauth-complete?status=ok`
 *      which dismisses the in-app browser.
 *
 * Why this is safe without the cookie pair: the cookie-pair check is CSRF
 * defence — a forged URL from a different origin won't carry our cookie.
 * For an iOS flow that the user explicitly initiated from their device,
 * there's no attacker-controlled origin to forge from. HMAC integrity +
 * 5-minute TTL on the state are sufficient.
 */
export async function POST(req: NextRequest) {
  let userId: number;
  try {
    const { user } = await requireAuth(req);
    userId = user.id;
  } catch (err) {
    if (err instanceof Response) return err;
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let authorizeUrl: string;
  try {
    const signedState = encodeWhoopOAuthState({ user_id: userId, flow: "ios" });
    authorizeUrl = buildAuthUrl(signedState);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "OAuth configuration error";
    return new NextResponse(message, { status: 500 });
  }

  return NextResponse.json({ authorize_url: authorizeUrl });
}
