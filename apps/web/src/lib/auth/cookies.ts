/**
 * Session cookie name for the web Sign in with Apple session JWT.
 *
 * The `__Host-` prefix is a browser-enforced contract: cookies with this
 * prefix MUST be sent with `Secure`, MUST have `Path=/`, and MUST NOT carry
 * a `Domain` attribute. That gives us a hard guarantee from the browser
 * that no subdomain can shadow this cookie. Next.js `cookies.set` honours
 * the prefix automatically as long as we configure those attributes.
 *
 * No `server-only` here so the proxy (edge) can also import the constant.
 */

export const COACH_SESSION_COOKIE = "__Host-coach_session";
export const COACH_SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60; // 7 days

/**
 * One-shot CSRF cookie for the SIWA web round-trip. Set by the start route
 * before the redirect to Apple, read+cleared by the callback route. Holds
 * a JSON payload `{ s: state, f?: from }` — `state` is the OAuth state
 * value; `f` is an optional same-origin path to bounce the user back to
 * after sign-in.
 *
 * NOT prefixed with `__Host-` because the cookie must travel back on
 * Apple's cross-site form_post POST, which requires `SameSite=None`.
 * `__Host-` cookies are nominally compatible with SameSite=None, but to
 * keep the SameSite=None+single-use semantics simple we use a plain name.
 * HttpOnly + Secure + 5-min TTL still apply.
 */
export const APPLE_OAUTH_STATE_COOKIE = "apple_oauth_state";
export const APPLE_OAUTH_STATE_MAX_AGE_SEC = 5 * 60;
