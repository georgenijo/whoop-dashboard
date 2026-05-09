/**
 * Sign-in page. No interactivity — the "Sign in with Apple" button is just
 * a link to /api/auth/apple-web/start. That route generates state, sets the
 * one-shot state cookie, and 302s to Apple. No client JS required.
 *
 * Server component so we can read query params (?error, ?from) at render
 * time and surface friendly messages without hydration cost.
 */

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

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = (await searchParams) ?? {};
  const errorText = errorMessage(params.error);
  const startHref = "/api/auth/apple-web/start";

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
        background: "#05050a",
        color: "var(--fg-0, #f5f5f7)",
        fontFamily: "var(--font-sans, -apple-system, BlinkMacSystemFont, sans-serif)",
        padding: 24,
      }}
    >
      <div
        style={{
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: -0.4,
        }}
      >
        whoop<span style={{ color: "#7b61ff" }}>+</span>
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
          background: "#000",
          color: "#fff",
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 500,
          textDecoration: "none",
          border: "1px solid rgba(255,255,255,0.18)",
          minWidth: 220,
        }}
      >
        <span aria-hidden style={{ fontSize: 16 }}>{""}</span>
        Sign in with Apple
      </a>
      {errorText && (
        <div
          role="alert"
          style={{
            maxWidth: 360,
            textAlign: "center",
            fontSize: 12,
            color: "#ff8b8b",
            background: "rgba(255,80,80,0.08)",
            border: "1px solid rgba(255,80,80,0.25)",
            padding: "10px 14px",
            borderRadius: 8,
          }}
        >
          {errorText}
        </div>
      )}
      {params.from && (
        <div style={{ fontSize: 11, opacity: 0.45 }}>
          You will be returned to <code>{params.from}</code> after signing in.
        </div>
      )}
    </div>
  );
}
