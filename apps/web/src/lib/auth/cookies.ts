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
