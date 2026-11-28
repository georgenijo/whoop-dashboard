import type {
  Basis,
  OutlookBand,
  OutlookLever,
  RecoveryOutlook,
} from "@/lib/analytics/recoveryOutlook";
import { bandColor, recoveryBand } from "@/components/plans/band";

const ACCENT = "#00d4aa";

export const OUTLOOK_DISCLAIMER =
  "Not a prediction of Whoop's score — a range based only on your own past days. Illness, alcohol, travel and stress can move it either way.";

const BASIS_TEXT: Record<Basis, string> = {
  cell: "days with similar sleep and strain",
  sleep: "days with similar sleep",
  strain: "days with similar strain",
  overall: "of your scored days (too few similar days, so the range is wider)",
};

function weekdayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

function Head({ sub }: { sub: string }) {
  return (
    <div className="card-head">
      <div>
        <div className="card-title">
          <span className="dot" style={{ background: ACCENT, color: ACCENT }} />
          Tomorrow&apos;s recovery outlook
        </div>
        <div className="card-sub" style={{ marginTop: 4 }}>{sub}</div>
      </div>
    </div>
  );
}

/** Horizontal 0–100 track with the band shaded and the median ticked. */
function BandBar({ band, testId }: { band: OutlookBand; testId?: string }) {
  const color = bandColor(recoveryBand(band.median));
  return (
    <div
      aria-hidden
      data-testid={testId}
      style={{ position: "relative", height: 8, borderRadius: 4, background: "rgba(255,255,255,0.06)" }}
    >
      <div
        style={{
          position: "absolute",
          left: `${band.low}%`,
          width: `${Math.max(1, band.high - band.low)}%`,
          top: 0,
          bottom: 0,
          borderRadius: 4,
          background: color,
          opacity: 0.55,
        }}
      />
      <div
        style={{ position: "absolute", left: `calc(${band.median}% - 1px)`, width: 2, top: -2, bottom: -2, background: color }}
      />
    </div>
  );
}

function LeverRow({ lever }: { lever: OutlookLever }) {
  const sign = lever.points >= 0 ? "+" : "−";
  return (
    <li data-testid="outlook-lever" style={{ listStyle: "none", display: "flex", justifyContent: "space-between", gap: 12, padding: "4px 0", fontSize: 12 }}>
      <span style={{ color: "var(--fg-1)" }}>{lever.change}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-0)", whiteSpace: "nowrap" }}>
        typically {sign}{Math.abs(lever.points)} pts for you
        <span style={{ color: "var(--fg-3)" }}> · {lever.n} days</span>
      </span>
    </li>
  );
}

export default function RecoveryOutlookCard({ outlook }: { outlook: RecoveryOutlook }) {
  if (outlook.status === "insufficient") {
    return (
      <div className="card" style={{ marginTop: 24 }} data-testid="recovery-outlook">
        <Head sub="Based only on your own past days" />
        <div className="empty-state">
          <div className="title">Not enough data yet</div>
          <div className="sub">
            {outlook.scoredDays} of {outlook.minDays} scored recovery days — keep wearing your strap and check back
          </div>
        </div>
      </div>
    );
  }

  const { headline, scenarios, levers } = outlook;
  const assumed = outlook.assumedSleep
    ? scenarios.find((s) => s.sleep === outlook.assumedSleep)!.label.toLowerCase()
    : null;
  const conditions = [
    assumed ? `your usual sleep (${assumed})` : null,
    outlook.todayStrain != null && outlook.strainBucket
      ? `today's ${outlook.strainBucket} strain so far (${outlook.todayStrain.toFixed(1)})`
      : null,
  ].filter(Boolean);

  return (
    <div className="card" style={{ marginTop: 24 }} data-testid="recovery-outlook">
      <Head sub={`For ${weekdayLabel(outlook.targetDate)} · from ${outlook.scoredDays} scored days (${outlook.start} → ${outlook.end})`} />
      <div style={{ padding: "0 4px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div data-testid="outlook-range" style={{ fontFamily: "var(--font-mono)", fontSize: 32, fontWeight: 600, color: "var(--fg-0)" }}>
            {headline.low}–{headline.high}%
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)" }}>
            likely band · typical {headline.median}%
          </div>
          <span
            data-testid="outlook-confidence"
            style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--fg-2)", border: "1px solid var(--border-subtle)", borderRadius: 999, padding: "2px 8px" }}
          >
            {headline.confidence} confidence
          </span>
        </div>
        <div style={{ marginTop: 10 }}>
          <BandBar band={headline} testId="outlook-bar" />
        </div>
        <div data-testid="outlook-basis" style={{ fontSize: 12, color: "var(--fg-1)", marginTop: 10 }}>
          {conditions.length > 0 ? `Assuming ${conditions.join(" and ")}. ` : ""}
          Based on {headline.n} {BASIS_TEXT[headline.basis]}.
        </div>

        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-3)", marginTop: 16, textTransform: "uppercase", letterSpacing: 0.6 }}>
          If tonight you get…
        </div>
        <ul style={{ margin: "6px 0 0", padding: 0 }}>
          {scenarios.map((s) => (
            <li
              key={s.sleep}
              data-testid="outlook-scenario"
              style={{ listStyle: "none", display: "grid", gridTemplateColumns: "minmax(0, 11rem) minmax(0, 1fr) auto", alignItems: "center", gap: 12, padding: "5px 0", fontSize: 12 }}
            >
              <span style={{ color: s.sleep === outlook.assumedSleep ? "var(--fg-0)" : "var(--fg-1)" }}>{s.label}</span>
              <BandBar band={s.band} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-1)", whiteSpace: "nowrap" }}>
                {s.band.low}–{s.band.high}%
                <span style={{ color: "var(--fg-3)" }}> · n {s.band.n}{s.band.basis === "overall" ? " (all days)" : ""}</span>
              </span>
            </li>
          ))}
        </ul>

        {levers.length > 0 && (
          <>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-3)", marginTop: 16, textTransform: "uppercase", letterSpacing: 0.6 }}>
              Biggest levers
            </div>
            <ul style={{ margin: "6px 0 0", padding: 0 }}>
              {levers.map((l) => (
                <LeverRow key={l.key} lever={l} />
              ))}
            </ul>
          </>
        )}

        <div data-testid="outlook-disclaimer" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)", marginTop: 14 }}>
          {OUTLOOK_DISCLAIMER}
        </div>
      </div>
    </div>
  );
}
