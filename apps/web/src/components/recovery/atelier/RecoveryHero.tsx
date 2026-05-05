import { recoveryZone, recoveryZoneGradientStops } from "@/lib/format";

type Props = {
  score: number | null;
  hrv: number | null;
  rhr: number | null;
  spo2: number | null;
  skinTemp: number | null;
  respRate: number | null;
};

export default function RecoveryHero({ score, hrv, rhr, spo2, skinTemp, respRate }: Props) {
  const zone = recoveryZone(score);
  const [g0] = recoveryZoneGradientStops(zone);
  const displayScore = score ?? 0;
  const circ = 2 * Math.PI * 54;
  const offset = circ * (1 - displayScore / 100);
  const angle = -Math.PI / 2 + (2 * Math.PI * displayScore) / 100;
  const endX = 64 + 54 * Math.cos(angle);
  const endY = 64 + 54 * Math.sin(angle);
  const hasScore = score != null;

  const metrics = [
    { roman: "i.", label: "HRV (In-RMSSD)", value: hrv != null ? `${hrv.toFixed(0)} ms` : "—" },
    { roman: "ii.", label: "Resting heart rate", value: rhr != null ? `${rhr.toFixed(0)} bpm` : "—" },
    { roman: "iii.", label: "SpO₂", value: spo2 != null ? `${spo2.toFixed(1)}%` : "—" },
    { roman: "iv.", label: "Skin temp Δ", value: skinTemp != null ? `${skinTemp > 0 ? "+" : ""}${skinTemp.toFixed(1)} °C` : "—" },
    { roman: "v.", label: "Respiratory rate", value: respRate != null ? `${respRate.toFixed(1)} rpm` : "—" },
  ];

  return (
    <div className="atelier-recovery-hero">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">I. Recovery / Plate N&#xba; 01</span>
        <span className="atelier-plate-page">002 / 008</span>
      </div>
      <h2 className="atelier-recovery-headline">
        Recovery, <em>measured over thirty mornings</em><br />
        of breath, beats, and quiet nerves.
      </h2>
      <div className="atelier-recovery-hero-body">
        <svg viewBox="0 0 128 128" className="atelier-recovery-ring" role="img" aria-label={`Recovery ${displayScore}`}>
          <circle cx="64" cy="64" r="54" fill="none" stroke="var(--line)" strokeWidth="6" />
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
          <text x="64" y="58" textAnchor="middle" fill="var(--ink-faint)" fontSize="7" fontWeight="600" letterSpacing="1.5" fontFamily="var(--font-display-sans)">RECOVERY</text>
          <text x="64" y="76" textAnchor="middle" fill="var(--ink)" fontSize="22" fontWeight="300" fontFamily="var(--font-display-sans)">{hasScore ? displayScore : "—"}</text>
          <text x="64" y="88" textAnchor="middle" fill="var(--ink-mute)" fontSize="7" fontFamily="var(--font-display-sans)">/ 100 · {zone.toUpperCase()}</text>
        </svg>
        <div className="atelier-recovery-metrics-list">
          {metrics.map((m) => (
            <div key={m.roman} className="atelier-recovery-metric-row">
              <span className="atelier-recovery-metric-roman">{m.roman}</span>
              <span className="atelier-recovery-metric-label">{m.label}</span>
              <span className="atelier-recovery-metric-value">{m.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
