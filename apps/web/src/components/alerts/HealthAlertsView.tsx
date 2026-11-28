import Link from "next/link";
import type {
  AlertSeverity,
  CheckStatus,
  HealthAlert,
  HealthAlertsResult,
} from "@/lib/analytics/healthAlerts";

// Health Alerts center (HEALTH_ALERTS=1). Presentational only: the page hands
// it the computed result. No client hooks, so it renders on the server.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 24" from "2026-11-24" without touching any runtime timezone. */
export function shortDate(date: string): string {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}`;
}

const SEVERITY: Record<AlertSeverity, { label: string; color: string }> = {
  act: { label: "Act", color: "var(--bad)" },
  watch: { label: "Watch", color: "var(--warn)" },
  info: { label: "Info", color: "var(--fg-3)" },
};

const CHECK_TEXT: Record<CheckStatus, string> = {
  flagged: "flagged",
  clear: "clear",
  insufficient: "not enough data",
  covered: "in illness alert",
};

function sinceText(a: HealthAlert): string | null {
  if (a.since && a.days != null) {
    return a.days <= 1 ? `since ${shortDate(a.since)}` : `since ${shortDate(a.since)} · ${a.days} days`;
  }
  if (a.days != null) return `last ${a.days} days`;
  return null;
}

function AlertRow({ alert }: { alert: HealthAlert }) {
  const sev = SEVERITY[alert.severity];
  const since = sinceText(alert);
  return (
    <li
      className="card"
      data-alert={alert.kind}
      data-severity={alert.severity}
      style={{ borderLeft: `3px solid ${sev.color}`, marginBottom: 12 }}
    >
      <div className="card-head" style={{ marginBottom: 6 }}>
        <div className="card-title">
          <span className="dot" style={{ background: sev.color, color: sev.color }} />
          {alert.title}
        </div>
        <span
          className="card-sub"
          style={{
            color: sev.color,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            fontFamily: "var(--font-num)",
          }}
        >
          {sev.label}
        </span>
      </div>
      <p style={{ margin: "0 0 8px", color: "var(--fg)", lineHeight: 1.5 }}>{alert.detail}</p>
      <p style={{ margin: "0 0 8px", color: "var(--fg-2)", fontSize: "var(--t-sm)", lineHeight: 1.5 }}>
        <span style={{ color: "var(--fg-3)" }}>What usually helps: </span>
        {alert.help}
      </p>
      <div className="card-sub" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {since && <span>{since}</span>}
        <Link href={alert.href} style={{ color: "var(--fg-2)" }}>
          See the chart →
        </Link>
      </div>
    </li>
  );
}

export default function HealthAlertsView({ result }: { result: HealthAlertsResult }) {
  const { alerts, checks, asOf } = result;
  const clearCount = checks.filter((c) => c.status === "clear").length;

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="card-sub" style={{ marginBottom: 16 }}>
        {asOf ? `Based on data through ${shortDate(asOf)}` : "No Whoop data yet"} · fixed rules
        against your own baselines · guidance, not medical advice
      </div>

      {alerts.length === 0 ? (
        <div className="card" data-testid="alerts-empty">
          <div className="empty-state">
            <div className="title">Nothing to flag</div>
            <div className="sub">
              {clearCount} of {checks.length} checks are within your usual range.
            </div>
          </div>
        </div>
      ) : (
        <ul aria-label="Health alerts" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {alerts.map((a) => (
            <AlertRow key={a.kind} alert={a} />
          ))}
        </ul>
      )}

      <div className="card" style={{ marginTop: 12 }}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          Checks
        </div>
        <ul
          aria-label="Checks"
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 8,
          }}
        >
          {checks.map((c) => (
            <li
              key={c.kind}
              data-check={c.kind}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "var(--t-sm)" }}
            >
              <span style={{ color: "var(--fg-2)" }}>{c.label}</span>
              <span
                style={{
                  fontFamily: "var(--font-num)",
                  color:
                    c.status === "flagged"
                      ? "var(--warn)"
                      : c.status === "clear"
                        ? "var(--ok)"
                        : "var(--fg-3)",
                }}
              >
                {CHECK_TEXT[c.status]}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
