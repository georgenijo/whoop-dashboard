/**
 * Onboarding nudge rendered on the overview page when no Whoop integration
 * row exists for the current user. Links back into the `/welcome` wizard at
 * the Connect step so the user can finish OAuth without re-doing the rest of
 * the onboarding flow.
 *
 * Mutually exclusive with NeedsReconnectBanner: the three-state partition
 * lives at the call site on /.
 */
export default function SetupCard() {
  return (
    <div className="card" aria-label="Finish setup">
      <div className="card-head">
        <div className="card-title">Finish setup</div>
      </div>
      <p
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          color: "var(--fg-1)",
          lineHeight: 1.55,
          margin: 0,
        }}
      >
        Finish setup — connect Whoop to start syncing your data.
      </p>
      <a
        href="/welcome?stage=connect"
        className="empty-state"
        style={{
          textDecoration: "none",
          border: "none",
          display: "inline-block",
          marginTop: 8,
          padding: 0,
        }}
      >
        <span className="cta">Connect Whoop →</span>
      </a>
    </div>
  );
}
