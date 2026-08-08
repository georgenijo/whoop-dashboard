/**
 * Sign-in page. No interactivity — the "Sign in with Apple" button is just
 * a link to /api/auth/apple-web/start. That route generates state, sets the
 * one-shot state cookie, and 302s to Apple. No client JS required.
 *
 * Server component so we can read query params (?error, ?from) at render
 * time and surface friendly messages without hydration cost.
 *
 * If the visitor already has a valid `__Host-coach_session` cookie, skip the
 * render and 307 to `/` (or a safe `?from=`). Pure SSR — no flicker.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COACH_SESSION_COOKIE } from "@/lib/auth/cookies";
import { getSessionUser } from "@/lib/auth";

type SignInPageProps = {
  searchParams?: Promise<{ error?: string; from?: string }>;
};

const ERROR_LABELS: Record<string, string> = {
  state_mismatch: "Sign-in security check failed. Please try again.",
  state_cookie_missing: "Your browser blocked a required cookie. Please retry.",
  missing_code: "Apple did not return an authorization code. Please retry.",
  missing_state: "Apple did not return a state value. Please retry.",
  invalid_request: "Apple sent an invalid response. Please retry.",
  apple_not_configured: "Sign in with Apple is not configured on this server.",
  token_exchange_failed: "Apple rejected the exchange. Please retry.",
  id_token_invalid: "Apple identity token failed verification.",
};

function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  return (
    ERROR_LABELS[code] ??
    `Sign-in failed (${code}). Please retry, or contact support.`
  );
}

// Server-side allowlist for the post-signin return path, mirroring the
// validator used by the callback. Reject anything that isn't a same-origin
// path so a hand-crafted /signin URL with `?from=https://evil/` cannot
// trick us into forwarding off-site after sign-in.
function safeFromParam(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  if (value.startsWith("/\\")) return null;
  if (value.length > 2048) return null;
  return value;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = (await searchParams) ?? {};
  const errorText = errorMessage(params.error);
  const safeFrom = safeFromParam(params.from);

  const sessionToken = (await cookies()).get(COACH_SESSION_COOKIE)?.value;
  if (sessionToken) {
    const user = await getSessionUser(sessionToken);
    if (user) {
      redirect(safeFrom ?? "/");
    }
  }

  const startHref = safeFrom
    ? `/api/auth/apple-web/start?from=${encodeURIComponent(safeFrom)}`
    : "/api/auth/apple-web/start";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        background: "var(--bg)",
        color: "var(--fg)",
        fontFamily: "var(--font-text)",
        padding: 24,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 17,
          fontWeight: 550,
          letterSpacing: -0.2,
        }}
      >
        <span
          aria-hidden
          style={{ width: 6, height: 6, borderRadius: 999, background: "var(--brand)" }}
        />
        Coach
      </div>
      <div
        style={{
          fontSize: 14,
          opacity: 0.65,
          maxWidth: 360,
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        Sign in with your Apple ID to access your dashboard, coach, and
        connected services.
      </div>
      <a
        href={startHref}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: "12px 20px",
          background: "var(--fg-hi)",
          color: "var(--bg)",
          borderRadius: "var(--r-md)",
          fontSize: 14,
          fontWeight: 500,
          textDecoration: "none",
          border: "var(--stroke) solid var(--fg-hi)",
          minWidth: 220,
        }}
      >
        <span aria-hidden style={{ fontSize: 16 }}>{""}</span>
        Sign in with Apple
      </a>
      <div
        style={{
          fontSize: 12,
          opacity: 0.5,
          maxWidth: 360,
          textAlign: "center",
          lineHeight: 1.5,
        }}
      >
        New here? Signing in creates your account automatically.
      </div>
      {errorText && (
        <div
          role="alert"
          style={{
            maxWidth: 360,
            textAlign: "center",
            fontSize: 12,
            color: "var(--bad)",
            background: "transparent",
            border: "var(--stroke) solid var(--bad)",
            padding: "10px 14px",
            borderRadius: "var(--r-md)",
          }}
        >
          {errorText}
        </div>
      )}
      {safeFrom && (
        <div style={{ fontSize: 11, opacity: 0.45 }}>
          You will be returned to <code>{safeFrom}</code> after signing in.
        </div>
      )}
    </div>
  );
}
