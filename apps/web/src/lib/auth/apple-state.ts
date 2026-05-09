/**
 * Helpers for the one-shot SIWA `apple_oauth_state` cookie payload.
 *
 * The cookie carries:
 *   - `s`: 32-byte hex CSRF state, echoed by Apple in the callback form_post.
 *   - `f`: optional same-origin path the user was trying to reach before
 *          we bounced them to /signin. Used to redirect them back after
 *          the round-trip completes.
 *
 * Encoded as JSON so the shape is self-describing — the cookie is HttpOnly
 * + Secure + 5-min TTL + single-use, so we don't need a signed envelope.
 *
 * No `server-only` here so the proxy module can also import (it doesn't
 * today, but the cookie name lives in `cookies.ts` for the same reason).
 */

export type AppleOAuthState = {
  state: string;
  from?: string;
};

/**
 * Validate that a path is safe to redirect to: must be same-origin (i.e. a
 * path starting with `/`), and must NOT be a protocol-relative URL or
 * Windows-style backslash escape, both of which can be abused to off-site
 * redirect through a cooperative proxy. Path-only — the caller decides
 * the origin.
 */
export function isSafeReturnPath(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith("/\\")) return false;
  if (value.length > 2048) return false;
  return true;
}

export function encodeAppleOAuthState(payload: AppleOAuthState): string {
  // JSON keeps the door open for additional fields (e.g. nonce) without
  // breaking older cookies that pre-date the new field.
  return JSON.stringify({ s: payload.state, ...(payload.from ? { f: payload.from } : {}) });
}

export function decodeAppleOAuthState(raw: string | null | undefined): AppleOAuthState | null {
  if (!raw) return null;
  // Tolerate the legacy plain-string format (state only, no JSON wrapper)
  // in case a cookie set by a previous deploy is still round-tripping. The
  // start route always writes JSON now, so this branch is purely a
  // forwards-compat safety net.
  if (!raw.startsWith("{")) {
    return { state: raw };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const s = parsed["s"];
    if (typeof s !== "string" || !s) return null;
    const f = parsed["f"];
    return {
      state: s,
      from: isSafeReturnPath(f) ? f : undefined,
    };
  } catch {
    return null;
  }
}
