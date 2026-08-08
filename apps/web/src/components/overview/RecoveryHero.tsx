import {
  recoveryZone,
  recoveryZoneLabel,
  formatUpdatedAt,
} from "@/lib/format";

type Props = {
  score: number | null;
  hrv: number | null;
  rhr: number | null;
  updatedAt: string | null;
};

export default function RecoveryHero({ score, hrv, rhr, updatedAt }: Props) {
  const zone = recoveryZone(score);
  const displayScore = score ?? 0;
  const circ = 2 * Math.PI * 58;
  const offset = circ * (1 - displayScore / 100);
  const hasScore = score != null;

  const bodyCopy = hasScore ? buildCopy(zone, hrv, rhr) : "Connect Whoop to see your recovery score.";

  return (
    <section className={`recovery-ring zone-${zone}`} aria-label="Recovery">
      <svg className="ring-svg" viewBox="0 0 132 132" role="img" aria-label={`Recovery ${displayScore} percent`}>
        <circle cx="66" cy="66" r="58" fill="none" stroke="var(--rule)" strokeWidth="3" />
        {hasScore && (
          <circle
            cx="66"
            cy="66"
            r="58"
            fill="none"
            stroke="var(--d-recovery)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circ}
            strokeDashoffset={offset}
            transform="rotate(-90 66 66)"
          />
        )}
      </svg>
      <div className="ring-readout">
        <span className="eyebrow">Recovery</span>
        <h2>
          {hasScore ? displayScore : "—"}
          <span className="pct">%</span>
        </h2>
        {hasScore && (
          <div className={`zone-tag zone-${zone}`}>
            <i />
            {recoveryZoneLabel(zone)}
          </div>
        )}
        <p>{bodyCopy}</p>
        <span className="recovery-updated">Updated {formatUpdatedAt(updatedAt)}</span>
      </div>
    </section>
  );
}

function buildCopy(zone: "green" | "yellow" | "red", hrv: number | null, rhr: number | null): string {
  const hrvStr = hrv != null ? `HRV ${hrv.toFixed(0)} ms` : null;
  const rhrStr = rhr != null ? `RHR ${rhr.toFixed(0)} bpm` : null;
  const suffix = [hrvStr, rhrStr].filter(Boolean).join(" · ");
  if (zone === "green") {
    return `Your body is ready. ${suffix ? suffix + ". " : ""}A moderate-to-hard session fits well.`;
  }
  if (zone === "yellow") {
    return `Moderate capacity today. ${suffix ? suffix + ". " : ""}Aim for a measured session and protect tomorrow.`;
  }
  return `Recovery is limited. ${suffix ? suffix + ". " : ""}Prioritize rest; keep strain low to rebound.`;
}
