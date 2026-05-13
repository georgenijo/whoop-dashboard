"use client";

/**
 * Coach-page banner surfaced when the Anthropic API call returns 401
 * (either through the SSE `error` event with `kind: "bad_api_key"` or a
 * non-stream JSON 401 with the same kind). Dismissal is ephemeral — local
 * React state in useCoachThread; resets to false at the top of every send.
 *
 * Link target uses /settings#coach-byok so the BYOK section scrolls into
 * view; the anchor is informational and the page works without it.
 */
type Props = {
  onDismiss: () => void;
};

export default function BadApiKeyBanner({ onDismiss }: Props) {
  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        background: "rgba(255,80,80,0.06)",
        border: "1px solid rgba(255,80,80,0.22)",
        borderRadius: 10,
        padding: "10px 14px",
        marginBottom: 12,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          color: "var(--fg-1)",
          lineHeight: 1.5,
        }}
      >
        Your Anthropic key was rejected.{" "}
        <a
          href="/settings#coach-byok"
          style={{ color: "#ff8b8b", textDecoration: "underline" }}
        >
          Update in Settings
        </a>
        .
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--fg-2)",
          fontSize: 18,
          lineHeight: 1,
          cursor: "pointer",
          padding: "0 4px",
        }}
      >
        ×
      </button>
    </div>
  );
}
