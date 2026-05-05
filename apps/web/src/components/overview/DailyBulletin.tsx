import type { InsightRow } from "@/lib/db";
import { recoveryZone, recoveryZoneGradientStops } from "@/lib/format";

type Props = {
  score: number | null;
  hrv: number | null;
  rhr: number | null;
  sleepPerf: number | null;
  respRate: number | null;
  skinTemp: number | null;
  insight: InsightRow | null;
  refreshing: boolean;
};

function headline(zone: "green" | "yellow" | "red", hrv: number | null): { bold: string; italic: string; rest: string } {
  if (zone === "green") return { italic: "green", bold: "recovery,", rest: "a measured day ahead." };
  if (zone === "yellow") return { italic: "moderate", bold: "capacity,", rest: "pace yourself today." };
  return { italic: "limited", bold: "recovery,", rest: "prioritize rest." };
}

function extractFirstSentence(markdown: string): string {
  const plain = markdown.replace(/#{1,6}\s.+/g, "").replace(/[*_`]/g, "").trim();
  const sentence = plain.match(/[^.!?]+[.!?]/)?.[0]?.trim();
  return sentence ?? plain.slice(0, 180);
}

export default function DailyBulletin({
  score, hrv, rhr, sleepPerf, respRate, skinTemp, insight, refreshing,
}: Props) {
  const zone = recoveryZone(score);
  const [g0] = recoveryZoneGradientStops(zone);
  const displayScore = score ?? 0;
  const circ = 2 * Math.PI * 54;
  const offset = circ * (1 - displayScore / 100);
  const angle = -Math.PI / 2 + (2 * Math.PI * displayScore) / 100;
  const endX = 64 + 54 * Math.cos(angle);
  const endY = 64 + 54 * Math.sin(angle);
  const hasScore = score != null;

  const now = new Date();
  const dayStr = now.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const dateStr = now.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const hl = headline(zone, hrv);
  const blurb = insight ? extractFirstSentence(insight.insight) : refreshing ? "Generating insight…" : "No insight yet.";

  const metrics = [
    { roman: "i.", label: "HRV (In-RMSSD)", value: hrv != null ? `${hrv.toFixed(0)} ms` : "—" },
    { roman: "ii.", label: "Resting heart rate", value: rhr != null ? `${rhr.toFixed(0)} bpm` : "—" },
    { roman: "iii.", label: "Sleep performance", value: sleepPerf != null ? `${sleepPerf.toFixed(0)}%` : "—" },
    { roman: "iv.", label: "Respiratory rate", value: respRate != null ? `${respRate.toFixed(1)} rpm` : "—" },
    { roman: "v.", label: "Skin temp Δ", value: skinTemp != null ? `${skinTemp > 0 ? "+" : ""}${skinTemp.toFixed(1)} °C` : "—" },
  ];

  return (
    <section className="bulletin-section">
      {/* Section header row */}
      <div className="bulletin-header-row">
        <span className="bulletin-section-label">
          <span className="bulletin-roman-accent">I.</span> Overview
        </span>
        <span className="bulletin-meta">
          DAILY BULLETIN — {dayStr} · {dateStr} · {timeStr}
        </span>
        <span className="bulletin-plate-num">004 / 008</span>
      </div>

      <div className="bulletin-body">
        {/* Left: headline + blurb */}
        <div className="bulletin-left">
          <div className="bulletin-tag">— DAILY BULLETIN</div>
          <h2 className="bulletin-headline">
            A <em>{hl.italic}</em> {hl.bold}<br />
            {hl.rest}
          </h2>
          <p className="bulletin-blurb">{blurb}</p>
          <div className="bulletin-figs">
            {hrv != null && <span>HRV {hrv > 0 ? "+" : ""}{hrv.toFixed(0)} ms vs. 7-day mean</span>}
            {rhr != null && <span>RHR {rhr.toFixed(0)} bpm vs. baseline</span>}
            {sleepPerf != null && <span>SpO₂ {sleepPerf.toFixed(0)}%</span>}
          </div>
        </div>

        {/* Right: Plate recovery panel */}
        <div className="bulletin-plate">
          <div className="bulletin-plate-header">
            <span>PLATE Nº 04 — RECOVERY</span>
          </div>
          <div className="bulletin-plate-body">
            <svg viewBox="0 0 128 128" className="bulletin-ring-svg" role="img" aria-label={`Recovery ${displayScore}`}>
              <circle cx="64" cy="64" r="54" fill="none" stroke="rgba(21,20,15,0.08)" strokeWidth="6" />
              {hasScore && (
                <>
                  <circle
                    cx="64" cy="64" r="54" fill="none"
                    stroke={g0} strokeWidth="6"
                    strokeLinecap="round"
                    strokeDasharray={circ}
                    strokeDashoffset={offset}
                    transform="rotate(-90 64 64)"
                  />
                  <circle cx={endX} cy={endY} r="3.5" fill={g0} />
                </>
              )}
              <text x="64" y="58" textAnchor="middle" fill="var(--fg-3)" fontSize="7" fontWeight="600" letterSpacing="1.5" fontFamily="var(--font-sans)">RECOVERY</text>
              <text x="64" y="76" textAnchor="middle" fill="var(--fg-0)" fontSize="22" fontWeight="700" fontFamily="var(--font-sans)">{hasScore ? displayScore : "—"}</text>
              <text x="64" y="88" textAnchor="middle" fill="var(--fg-2)" fontSize="7" fontFamily="var(--font-mono)">/ 100 · {zone.toUpperCase()}</text>
            </svg>
            <div className="bulletin-metrics-list">
              {metrics.map((m) => (
                <div key={m.roman} className="bulletin-metric-row">
                  <span className="bm-roman">{m.roman}</span>
                  <span className="bm-label">{m.label}</span>
                  <span className="bm-value">{m.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
