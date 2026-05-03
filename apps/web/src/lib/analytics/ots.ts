import { linearSlope } from "@/lib/stats";

export type OTSResult = {
  score: 0 | 1 | 2 | 3;
  level: "low" | "moderate" | "high";
  label: string;
  color: string;
  slopes: { hrv: number; rhr: number; recovery: number; strain: number };
  signals: { hrv: boolean; rhr: boolean; recovery: boolean; strainElevated: boolean };
};

type RecoveryInput = {
  date: string;
  hrv: number | null;
  rhr: number | null;
  recovery_score: number | null;
};

type CycleInput = {
  date: string;
  strain: number | null;
};

type Joined = { date: string; hrv: number; rhr: number; recovery: number; strain: number };

export function computeOTS(recovery: RecoveryInput[], cycles: CycleInput[]): OTSResult | null {
  if (recovery.length === 0 || cycles.length === 0) return null;

  const strainByDate = new Map<string, number>();
  for (const c of cycles) {
    if (c.strain != null && Number.isFinite(c.strain)) strainByDate.set(c.date, c.strain);
  }

  const joined: Joined[] = [];
  for (const r of recovery) {
    const strain = strainByDate.get(r.date);
    if (
      strain == null ||
      r.hrv == null || !Number.isFinite(r.hrv) ||
      r.rhr == null || !Number.isFinite(r.rhr) ||
      r.recovery_score == null || !Number.isFinite(r.recovery_score)
    ) continue;
    joined.push({ date: r.date, hrv: r.hrv, rhr: r.rhr, recovery: r.recovery_score, strain });
  }

  if (joined.length < 7) return null;

  joined.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const window = joined.slice(-7);

  const hrvSlope = linearSlope(window.map((w) => w.hrv));
  const rhrSlope = linearSlope(window.map((w) => w.rhr));
  const recSlope = linearSlope(window.map((w) => w.recovery));
  const strainSlope = linearSlope(window.map((w) => w.strain));

  const hrvSignal = hrvSlope < 0;
  const rhrSignal = rhrSlope > 0;
  const recSignal = recSlope < 0;
  const strainElevated = strainSlope >= -0.1;

  const fired = (hrvSignal ? 1 : 0) + (rhrSignal ? 1 : 0) + (recSignal ? 1 : 0);
  const score = (strainElevated ? fired : 0) as 0 | 1 | 2 | 3;

  let level: OTSResult["level"];
  let label: string;
  let color: string;
  if (score === 0) {
    level = "low";
    label = "No overtraining signals detected";
    color = "#00d4aa";
  } else if (score <= 2) {
    level = "moderate";
    label = `Moderate OTS risk — ${score} of 3 stress signals present`;
    color = "#ffaa00";
  } else {
    level = "high";
    label = "High OTS risk — all stress signals firing with sustained strain";
    color = "#ff6b6b";
  }

  return {
    score,
    level,
    label,
    color,
    slopes: {
      hrv: round3(hrvSlope),
      rhr: round3(rhrSlope),
      recovery: round3(recSlope),
      strain: round3(strainSlope),
    },
    signals: {
      hrv: hrvSignal,
      rhr: rhrSignal,
      recovery: recSignal,
      strainElevated,
    },
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
