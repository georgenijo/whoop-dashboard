import {
  recoveryZone,
  recoveryZoneLabel,
  recoveryZoneGradientStops,
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
  const [g0, g1] = recoveryZoneGradientStops(zone);
  const displayScore = score ?? 0;
  const circ = 2 * Math.PI * 90;
  const offset = circ * (1 - displayScore / 100);
  const hasScore = score != null;
  const angle = -Math.PI / 2 + (2 * Math.PI * displayScore) / 100;
  const endX = 105 + 90 * Math.cos(angle);
  const endY = 105 + 90 * Math.sin(angle);

  const bodyCopy = hasScore ? buildCopy(zone, hrv, rhr) : "Connect Whoop to see your recovery score.";

  return (
    <section className={`recovery-ring zone-${zone}`} aria-label="Recovery">
      <svg className="ring-svg" viewBox="0 0 210 210" role="img" aria-label={`Recovery ${displayScore} percent`}>
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={g0} />
            <stop offset="100%" stopColor={g1} />
          </linearGradient>
          <filter id="ring-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx="105" cy="105" r="90" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
        <circle cx="105" cy="105" r="72" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
        {hasScore && (
          <>
            <circle
              cx="105"
              cy="105"
              r="90"
              fill="none"
              stroke="url(#ring-grad)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
              transform="rotate(-90 105 105)"
              filter="url(#ring-glow)"
            />
            <circle cx={endX} cy={endY} r="5" fill={g0} style={{ filter: `drop-shadow(0 0 8px ${g0})` }} />
          </>
        )}
        <text x="105" y="100" textAnchor="middle" fill="#6b6b74" fontSize="10" fontWeight="600" letterSpacing="1.5">
          RECOVERY
        </text>
        <text x="105" y="120" textAnchor="middle" fill="#a1a1aa" fontFamily="var(--font-mono)" fontSize="10">
          {formatUpdatedAt(updatedAt)}
        </text>
      </svg>
      <div className="ring-readout">
        <span className="eyebrow">Today&apos;s recovery</span>
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
