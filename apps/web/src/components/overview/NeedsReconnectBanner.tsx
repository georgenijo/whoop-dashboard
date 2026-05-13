/**
 * Overview-page banner rendered when the Whoop integration row exists but
 * `needs_reauth` is set (refresh-token rejected, user revoked Whoop side,
 * etc.). Links to /settings where the Connectors card exposes a Reconnect
 * button against the same OAuth start route.
 *
 * Mutually exclusive with SetupCard: the partition lives at the call site
 * on /. Yellow accent (#fbbf24) matches the "Needs reconnect" status pill
 * used in the settings Connectors card.
 */
export default function NeedsReconnectBanner() {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "12px 14px",
        background: "rgba(251,191,36,0.06)",
        border: "1px solid rgba(251,191,36,0.18)",
        borderRadius: 12,
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
        Your Whoop connection expired — reconnect to resume syncing.
      </span>
      <a
        href="/settings"
        style={{
          background: "transparent",
          border: "1px solid rgba(251,191,36,0.4)",
          color: "#fbbf24",
          padding: "6px 12px",
          borderRadius: 6,
          fontSize: 12,
          fontFamily: "var(--font-sans)",
          fontWeight: 500,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        Reconnect
      </a>
    </div>
  );
}
