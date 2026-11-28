import type {
  DriverFinding,
  DriverResult,
  RecoveryDriversResult,
} from "@/lib/analytics/recoveryDrivers";

const ACCENT = "#00d4aa";
const NEG = "#ff6b6b";
/** |r| at which a bar fills its track. Strong associations rarely exceed this. */
const BAR_FULL_R = 0.6;

function Head({ sub }: { sub: string }) {
  return (
    <div className="card-head">
      <div>
        <div className="card-title">
          <span className="dot" style={{ background: ACCENT, color: ACCENT }} />
          What moves your recovery
        </div>
        <div className="card-sub" style={{ marginTop: 4 }}>{sub}</div>
      </div>
    </div>
  );
}

function FindingRow({ f, rank }: { f: DriverFinding; rank: number }) {
  const color = f.effectPoints >= 0 ? ACCENT : NEG;
  const width = Math.min(100, (Math.abs(f.correlation) / BAR_FULL_R) * 100);
  return (
    <li data-testid="driver-finding" style={{ listStyle: "none", padding: "12px 0", borderTop: rank > 1 ? "1px solid var(--border-subtle)" : undefined }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500, color: "var(--fg-0)" }}>
          <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg-3)", marginRight: 8 }}>{rank}</span>
          {f.label}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-3)", whiteSpace: "nowrap" }}>
          {f.strength} · r {f.correlation >= 0 ? "+" : "−"}{Math.abs(f.correlation).toFixed(2)} · {f.n} days
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--fg-1)", marginTop: 4 }}>{f.summary}</div>
      <div
        aria-hidden
        style={{ marginTop: 8, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}
      >
        <div data-testid="driver-bar" style={{ width: `${width.toFixed(0)}%`, height: "100%", background: color, opacity: 0.85 }} />
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)", marginTop: 4 }}>
        {f.highMean.toFixed(0)}% avg ({f.highN} days) vs {f.lowMean.toFixed(0)}% avg ({f.lowN} days)
      </div>
    </li>
  );
}

function OtherRow({ d }: { d: DriverResult }) {
  const text =
    d.status === "finding"
      ? `${d.strength} · ${d.summary}`
      : d.status === "insufficient"
        ? `Not enough data — ${d.reason.charAt(0).toLowerCase()}${d.reason.slice(1)}`
        : "No clear pattern";
  return (
    <li data-testid="driver-other" style={{ listStyle: "none", display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0", fontSize: 11.5 }}>
      <span style={{ color: "var(--fg-1)" }}>{d.label}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-3)", textAlign: "right" }}>{text}</span>
    </li>
  );
}

const CAVEAT =
  "Associations in your own data, not causes — other things (illness, travel, stress) can drive both.";

export default function RecoveryDriversCard({ result }: { result: RecoveryDriversResult }) {
  if (result.status === "insufficient") {
    return (
      <div className="card" style={{ marginTop: 24 }} data-testid="recovery-drivers">
        <Head sub="Your habits vs your recovery" />
        <div className="empty-state">
          <div className="title">Not enough data yet</div>
          <div className="sub">
            {result.pairedDays} of {result.minDays} scored recovery days — keep wearing your strap and check back
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 24 }} data-testid="recovery-drivers">
      <Head sub={`Last ${result.pairedDays} scored days · ${result.start} → ${result.end}`} />
      <div style={{ padding: "0 4px" }}>
        {result.top.length === 0 ? (
          <div className="empty-state" style={{ padding: "24px 16px" }}>
            <div className="title">No clear pattern yet</div>
            <div className="sub">None of your habits below line up with your recovery strongly enough to call it</div>
          </div>
        ) : (
          <ol style={{ margin: 0, padding: 0 }}>
            {result.top.map((f, i) => (
              <FindingRow key={f.key} f={f} rank={i + 1} />
            ))}
          </ol>
        )}
        {result.others.length > 0 && (
          <ul style={{ margin: "8px 0 0", padding: "8px 0 0", borderTop: "1px solid var(--border-subtle)" }}>
            {result.others.map((d) => (
              <OtherRow key={d.key} d={d} />
            ))}
          </ul>
        )}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)", marginTop: 12 }}>
          {CAVEAT}
        </div>
      </div>
    </div>
  );
}
