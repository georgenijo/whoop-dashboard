import type { CredentialHealthRow } from "@/lib/db/credential-health";

// Issue #525 — shared CURSOR_API_KEY health, written by the keepalive-driven
// probe (lib/coach/shared-key-probe.ts). Server component: props only, no
// key material ever reaches it (the row holds status + timestamps).

type Props = {
  row: CredentialHealthRow | null;
  enabled: boolean;
  configured: boolean;
};

const TONE = {
  ok: { label: "OK", color: "#00d4aa" },
  invalid: { label: "Invalid", color: "#ff6b6b" },
  unreachable: { label: "Unreachable", color: "#f5a524" },
  idle: { label: "Not checked", color: "#8a8f98" },
} as const;

function fmt(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function credentialHealthSummary({ row, enabled, configured }: Props): {
  tone: keyof typeof TONE;
  note: string;
} {
  if (!configured) {
    return { tone: "idle", note: "No shared CURSOR_API_KEY is configured on the server." };
  }
  if (!row) {
    return {
      tone: "idle",
      note: enabled
        ? "Probe enabled; waiting for the next keepalive tick (every 30 min)."
        : "Periodic probe is off. Set COACH_KEY_PROBE=on to check the shared key every 30 minutes.",
    };
  }
  const stale = enabled ? "" : " Probe is currently off, so this result is not refreshing.";
  if (row.status === "invalid") {
    return {
      tone: "invalid",
      note:
        (row.incident_open
          ? "Cursor keeps rejecting the shared key. Coach turns that fall back to it will fail until it is rotated."
          : "Cursor rejected the shared key on the last check.") + stale,
    };
  }
  if (row.status === "unreachable") {
    return { tone: "unreachable", note: "Could not reach Cursor's model catalog on the last check." + stale };
  }
  return { tone: "ok", note: "Cursor accepted the shared key on the last check." + stale };
}

export default function CredentialHealthCard(props: Props) {
  const { row } = props;
  const { tone, note } = credentialHealthSummary(props);
  const t = TONE[tone];
  return (
    <div className="card" style={{ padding: "16px 20px" }} aria-label="Shared Cursor key health">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="card-title">Shared Cursor key</div>
          <span className="card-sub">{note}</span>
        </div>
        <span
          data-status={tone}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "6px 11px",
            borderRadius: 9999,
            border: `1px solid ${t.color}55`,
            color: t.color,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
          {t.label}
        </span>
      </div>
      {row && (
        <div className="card-sub" style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 10 }}>
          <span>Last checked {fmt(row.last_checked)}</span>
          <span>Last OK {fmt(row.last_ok)}</span>
          {row.consecutive_invalid > 0 && <span>{row.consecutive_invalid} consecutive rejection{row.consecutive_invalid === 1 ? "" : "s"}</span>}
        </div>
      )}
    </div>
  );
}
