/**
 * Motion primitives shared by the Coach surface.
 *
 * One spring model drives both CSS and JS motion so a number that counts up
 * settles on the same curve as the card it lives in. The parameterisation
 * matches SwiftUI's `.spring(duration:bounce:)` (the vocabulary Margin uses):
 * `duration` is the perceptual period, `bounce` 0 is critically damped and
 * anything above it overshoots. The CSS `linear()` curves in `tokens.css`
 * (`--spring-smooth`, `--spring-snappy`, `--spring-bouncy`) are sampled from
 * `springProgress` with the same parameters; keep the two in step.
 */

export type SpringConfig = { duration: number; bounce: number };

export const SPRINGS = {
  smooth: { duration: 0.5, bounce: 0 },
  snappy: { duration: 0.45, bounce: 0.15 },
  bouncy: { duration: 0.6, bounce: 0.28 },
} as const satisfies Record<string, SpringConfig>;

/** Position (0 → 1, may overshoot) of a unit spring step `t` seconds in. */
export function springProgress(t: number, { duration, bounce }: SpringConfig): number {
  if (t <= 0) return 0;
  const omega = (2 * Math.PI) / duration;
  const zeta = 1 - bounce;
  if (zeta >= 1) return 1 - Math.exp(-omega * t) * (1 + omega * t);
  const omegaD = omega * Math.sqrt(1 - zeta * zeta);
  return (
    1 -
    Math.exp(-zeta * omega * t) *
      (Math.cos(omegaD * t) + ((zeta * omega) / omegaD) * Math.sin(omegaD * t))
  );
}

/**
 * Seconds until the spring stays within `tolerance` of rest. Used as the
 * length of a JS tween so it ends exactly when the motion is imperceptible.
 */
export function springSettleTime(config: SpringConfig, tolerance = 0.002): number {
  const step = 0.005;
  let lastOutside = 0;
  for (let t = 0; t < 6; t += step) {
    if (Math.abs(1 - springProgress(t, config)) > tolerance) lastOutside = t;
  }
  return lastOutside + step;
}

/** A `display_value` split around its single animatable number. */
export type ParsedDisplay = {
  prefix: string;
  value: number;
  decimals: number;
  grouped: boolean;
  suffix: string;
};

const NUMBER_PATTERN = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g;

/**
 * Finds the one number in a display string ("78%", "45.8 ms", "1,204 kJ") so
 * it can be animated while the surrounding text stays put. Returns null when
 * there is no number or more than one ("7h 12m", "6–8"): animating one part of
 * a compound value would make it read wrong mid-flight.
 */
export function parseDisplayNumber(display: string): ParsedDisplay | null {
  const matches = [...display.matchAll(NUMBER_PATTERN)];
  if (matches.length !== 1) return null;
  const [match] = matches;
  const raw = match[0];
  const index = match.index ?? 0;
  const grouped = raw.includes(",");
  const plain = raw.replaceAll(",", "");
  const value = Number(plain);
  if (!Number.isFinite(value)) return null;
  const dot = plain.indexOf(".");
  return {
    prefix: display.slice(0, index),
    value,
    decimals: dot === -1 ? 0 : plain.length - dot - 1,
    grouped,
    suffix: display.slice(index + raw.length),
  };
}

/** Renders an in-flight value with the shape of the original display string. */
export function formatParsedDisplay(parsed: ParsedDisplay, value: number): string {
  const number = parsed.grouped
    ? value.toLocaleString("en-US", {
        minimumFractionDigits: parsed.decimals,
        maximumFractionDigits: parsed.decimals,
      })
    : value.toFixed(parsed.decimals);
  return `${parsed.prefix}${number}${parsed.suffix}`;
}

export type MetricAccent = "recovery" | "strain" | "sleep" | "hrv" | "rhr" | "spo2" | "neutral";

const ACCENT_RULES: Array<[RegExp, MetricAccent]> = [
  [/\bhrv\b|variability/i, "hrv"],
  [/resting\s*h(eart\s*)?r(ate)?|\brhr\b|heart\s*rate|\bbpm\b/i, "rhr"],
  [/spo2|oxygen|resp(iratory)?/i, "spo2"],
  [/recover/i, "recovery"],
  [/sleep|rem\b|deep|nap|bed/i, "sleep"],
  [/strain|kj|calorie|workout|exertion|load|zone/i, "strain"],
];

/** Maps a metric label (and optionally its unit) to its data color family. */
export function metricAccent(label: string, unit = ""): MetricAccent {
  const text = `${label} ${unit}`;
  for (const [pattern, accent] of ACCENT_RULES) {
    if (pattern.test(text)) return accent;
  }
  return "neutral";
}

/** CSS custom property holding the color for an accent. */
export function accentVar(accent: MetricAccent): string {
  return accent === "neutral" ? "var(--fg-2)" : `var(--d-${accent})`;
}

/**
 * Where a current value sits against its baseline on a symmetric scale, as a
 * fraction of the track (0.5 is "at baseline"). The scale is ±50% of the
 * baseline so ordinary day-to-day movement reads as a visible, not maxed,
 * shift. Returns null when either side is missing.
 */
export function baselinePosition(current: number | null, baseline: number | null): number | null {
  if (current === null || baseline === null) return null;
  if (!Number.isFinite(current) || !Number.isFinite(baseline)) return null;
  const span = Math.abs(baseline) * 0.5 || 1;
  const offset = (current - baseline) / span;
  return Math.min(1, Math.max(0, 0.5 + offset / 2));
}
