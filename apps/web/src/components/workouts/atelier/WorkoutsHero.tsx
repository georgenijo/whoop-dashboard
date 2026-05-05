import type { WorkoutRow } from "@/lib/db";

type Props = { cur: WorkoutRow[]; prev: WorkoutRow[] };

function mean(vals: (number | null)[]): number | null {
  const filtered = vals.filter((v): v is number => v != null);
  if (filtered.length === 0) return null;
  return filtered.reduce((a, b) => a + b, 0) / filtered.length;
}

function delta(cur: number | null, prev: number | null): { sign: string; val: string; cls: string } {
  if (cur == null || prev == null || prev === 0) return { sign: "", val: "—", cls: "flat" };
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 0.5) return { sign: "", val: "—", cls: "flat" };
  return pct > 0
    ? { sign: "+", val: `${pct.toFixed(0)}%`, cls: "up" }
    : { sign: "", val: `${pct.toFixed(0)}%`, cls: "down" };
}

export default function WorkoutsHero({ cur, prev }: Props) {
  const curVolume = cur.length;
  const prevVolume = prev.length;
  const volumeDelta = delta(curVolume, prevVolume);

  const curIntensity = mean(cur.map((r) => r.strain));
  const prevIntensity = mean(prev.map((r) => r.strain));
  const intensityDelta = delta(curIntensity, prevIntensity);

  const curDuration = mean(cur.map((r) => r.duration_sec != null ? r.duration_sec / 60 : null));
  const prevDuration = mean(prev.map((r) => r.duration_sec != null ? r.duration_sec / 60 : null));
  const durationDelta = delta(curDuration, prevDuration);

  const curMaxHR = mean(cur.map((r) => r.max_hr));
  const prevMaxHR = mean(prev.map((r) => r.max_hr));
  const maxHRDelta = delta(curMaxHR, prevMaxHR);

  const kpis = [
    {
      roman: "I",
      label: "VOLUME",
      value: String(curVolume),
      unit: "sessions",
      d: volumeDelta,
    },
    {
      roman: "II",
      label: "INTENSITY",
      value: curIntensity != null ? curIntensity.toFixed(1) : "—",
      unit: "avg strain",
      d: intensityDelta,
    },
    {
      roman: "III",
      label: "DURATION",
      value: curDuration != null ? `${curDuration.toFixed(0)}m` : "—",
      unit: "avg / session",
      d: durationDelta,
    },
    {
      roman: "IV",
      label: "MAX HR AVG",
      value: curMaxHR != null ? `${curMaxHR.toFixed(0)}` : "—",
      unit: "bpm",
      d: maxHRDelta,
    },
  ];

  return (
    <div className="atelier-workouts-hero">
      <div className="atelier-plate-head">
        <span className="atelier-plate-fig">I. Workouts / Plate N&#xba; 01</span>
        <span className="atelier-plate-page">001 / 003</span>
      </div>
      <h2 className="atelier-workouts-headline">
        Workouts, <em>logged.</em>
      </h2>
      <div className="atelier-workouts-kpi-row">
        {kpis.map((k) => (
          <div key={k.roman} className="atelier-workouts-kpi-card">
            <span className="atelier-workouts-kpi-roman">{k.roman}</span>
            <span className="atelier-workouts-kpi-label">{k.label}</span>
            <span className="atelier-workouts-kpi-value">{k.value}</span>
            <span className="atelier-workouts-kpi-unit">{k.unit}</span>
            {k.d.val !== "—" && (
              <span className={`atelier-workouts-kpi-delta metric-delta ${k.d.cls}`}>
                {k.d.sign}{k.d.val} vs prev 28d
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
