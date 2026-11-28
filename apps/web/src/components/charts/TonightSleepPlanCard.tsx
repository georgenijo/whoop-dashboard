// Server-renderable (no hooks, no client JS): the plan is computed on the
// server and this card is static markup.
import type { SleepPlan, SleepPlanStrip } from "@/lib/analytics/sleepPlan";
import { formatClock } from "@/lib/analytics/sleepPlan";

const ACCENT = "#7b61ff";
const COLOR_LATE = "#ffaa00";
const COLOR_ON = "#00d4aa";
/** Strip spans planned bedtime ± this many minutes; further dots are clamped. */
const STRIP_SPAN_MIN = 120;
const ON_PLAN_MIN = 15;

function formatHoursMinutes(ms: number): string {
  const total = Math.round(ms / 60_000);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

function formatDelta(min: number): string {
  if (Math.abs(min) < 1) return "on plan";
  const abs = Math.abs(min);
  const text = abs >= 60 ? `${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, "0")}m` : `${abs}m`;
  return min > 0 ? `${text} later` : `${text} earlier`;
}

function weekday(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function Header({ sub }: { sub: string }) {
  return (
    <div className="card-head">
      <div>
        <div className="card-title">
          <span className="dot" style={{ background: ACCENT, color: ACCENT }} />
          Tonight
        </div>
        <div className="card-sub" style={{ marginTop: 4 }}>{sub}</div>
      </div>
    </div>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 96 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </span>
      <span
        data-testid={testId}
        style={{ fontFamily: "var(--font-display)", fontSize: 22, fontWeight: 500, color: "var(--fg-1)", fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </span>
    </div>
  );
}

function BedtimeStrip({ strip, bedtimeMin }: { strip: SleepPlanStrip[]; bedtimeMin: number }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)", marginBottom: 6 }}>
        Planned {formatClock(bedtimeMin)} vs your last {strip.length} bedtimes
      </div>
      <div
        role="img"
        aria-label={`Planned bedtime ${formatClock(bedtimeMin)} compared with your last ${strip.length} bedtimes`}
        style={{ position: "relative", height: 34, borderRadius: 6, background: "rgba(255,255,255,0.03)" }}
      >
        <div style={{ position: "absolute", left: 0, right: 0, top: 16, height: 1, background: "rgba(255,255,255,0.08)" }} />
        <div
          aria-hidden
          style={{ position: "absolute", left: "50%", top: 3, bottom: 3, width: 2, marginLeft: -1, background: ACCENT, borderRadius: 1 }}
        />
        {strip.map((n) => {
          const clamped = Math.max(-STRIP_SPAN_MIN, Math.min(STRIP_SPAN_MIN, n.deltaMin));
          const left = 50 + (clamped / STRIP_SPAN_MIN) * 46;
          const color = Math.abs(n.deltaMin) <= ON_PLAN_MIN ? COLOR_ON : COLOR_LATE;
          return (
            <span
              key={n.date}
              data-testid="bedtime-dot"
              title={`${weekday(n.bedDate)} ${formatClock(n.bedMin)} · ${formatDelta(n.deltaMin)}`}
              style={{
                position: "absolute",
                left: `${left}%`,
                top: 11,
                width: 10,
                height: 10,
                marginLeft: -5,
                borderRadius: "50%",
                background: color,
                opacity: 0.85,
                boxShadow: "0 0 0 2px rgba(5,5,10,0.9)",
              }}
            />
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-3)", marginTop: 4 }}>
        <span>−2h</span>
        <span>planned</span>
        <span>+2h</span>
      </div>
      <ol style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 6 }}>
        {strip.map((n) => (
          <li key={n.date} style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-2)" }}>
            <span style={{ color: "var(--fg-3)" }}>{weekday(n.bedDate)}</span> {formatClock(n.bedMin)}{" "}
            <span style={{ color: Math.abs(n.deltaMin) <= ON_PLAN_MIN ? COLOR_ON : COLOR_LATE }}>
              {n.deltaMin > 0 ? "+" : n.deltaMin < 0 ? "−" : "±"}
              {Math.abs(n.deltaMin)}m
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function TonightSleepPlanCard({ plan }: { plan: SleepPlan }) {
  if (plan.status === "insufficient") {
    return (
      <div className="card" style={{ marginTop: 24 }} data-testid="tonight-sleep-plan">
        <Header sub="Suggested bedtime · guidance only" />
        <div className="empty-state">
          <div className="title">Not enough nights for a plan yet</div>
          <div className="sub">
            Logged {plan.nights} of {plan.needed} nights needed — keep wearing your strap and a bedtime suggestion will appear here.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 24 }} data-testid="tonight-sleep-plan">
      <Header sub={`Suggested bedtime for a ${formatClock(plan.wakeMin)} wake · based on your last ${plan.nights} nights · guidance only`} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-end" }}>
        <Stat label="Wind down" value={formatClock(plan.windDownMin)} testId="plan-winddown" />
        <Stat
          label={plan.bedtimeAfterMidnight ? "In bed (after midnight)" : "In bed by"}
          value={formatClock(plan.bedtimeMin)}
          testId="plan-bedtime"
        />
        <Stat label="Wake" value={formatClock(plan.wakeMin)} testId="plan-wake" />
        <Stat label="Sleep it yields" value={formatHoursMinutes(plan.yieldSleepMs)} testId="plan-yield" />
      </div>
      <p data-testid="plan-reason" style={{ margin: "14px 0 0", fontSize: 13, color: "var(--fg-2)", lineHeight: 1.5 }}>
        {plan.reason}.
      </p>
      {plan.irregular && (
        <p data-testid="plan-irregular" style={{ margin: "6px 0 0", fontFamily: "var(--font-mono)", fontSize: 10, color: COLOR_LATE }}>
          Irregular schedule detected
        </p>
      )}
      {plan.strip.length > 0 && <BedtimeStrip strip={plan.strip} bedtimeMin={plan.bedtimeMin} />}
    </div>
  );
}
