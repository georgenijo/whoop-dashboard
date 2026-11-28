import "server-only";
import type { CycleRow, RecoveryRow, SleepRow } from "@/lib/db";
import { computeIllnessSignal, type IllnessRow } from "@/lib/analytics/illness";
import { computeOTS } from "@/lib/analytics/ots";
import { detectHRVAnomalies } from "@/lib/analytics/trends";
import {
  SKIN_TEMP_ELEVATED_THRESHOLD,
  latestElevatedSkinTempRun,
} from "@/lib/analytics/skinTemp";

// Health Alerts center (HEALTH_ALERTS=1). Pure, deterministic rules over rows
// the caller already read through the user-scoped readers. No AI, no network,
// no DB access here. Every rule reuses an existing analytics function so an
// alert never disagrees with the card that shows the same signal:
//
//   illness       computeIllnessSignal (IllnessSignalCard): >=2 of 3 signals
//   overtraining  computeOTS (OvertrainingCard): score >= 2 of 3
//   hrv_low       detectHRVAnomalies (HRVTrend's 30-day 1.5σ band)
//   rhr_high      computeIllnessSignal's rhr_flag (> 14-day baseline + 3 bpm)
//   skin_temp     latestElevatedSkinTempRun (SkinTempDeviationCard): >= 2 days
//   resp_rate     computeIllnessSignal's resp deviation, ±2 br/min
//                 (RespiratoryRateChart's threshold, today excluded from baseline)
//   sleep_debt    Whoop's own need_from_debt_ms on the latest night
//   freshness     newest data date vs the user's local today
//
// Dates are calendar strings (YYYY-MM-DD) compared via UTC midnights, so DST
// transitions and the server's own timezone never shift a day count.

export type AlertSeverity = "info" | "watch" | "act";

export type AlertKind =
  | "freshness"
  | "illness"
  | "overtraining"
  | "sleep_debt"
  | "hrv_low"
  | "rhr_high"
  | "skin_temp"
  | "resp_rate";

export type HealthAlert = {
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  /** One plain sentence with the numbers behind the alert. */
  detail: string;
  /** First date (YYYY-MM-DD) of the current run, when the rule has one. */
  since: string | null;
  /** Length of the current run in calendar days, when the rule has one. */
  days: number | null;
  /** What usually helps. Fixed copy; guidance, not medical advice. */
  help: string;
  /** Dashboard page with the full chart for this signal. */
  href: string;
};

export type CheckStatus = "flagged" | "clear" | "insufficient" | "covered";

export type HealthCheck = { kind: AlertKind; label: string; status: CheckStatus };

export type HealthAlertsResult = {
  alerts: HealthAlert[];
  checks: HealthCheck[];
  /** Newest date with any Whoop data, or null when there is none. */
  asOf: string | null;
};

export type HealthAlertsInput = {
  /** The user's local calendar date. */
  today: string;
  /** Current instant, for "last sync N h ago". */
  nowMs: number;
  recovery: RecoveryRow[];
  sleep: SleepRow[];
  cycles: CycleRow[];
  lastSyncAt: Date | null;
};

/** Rows the loader should fetch: HRV's 30-day band needs 30 days of history behind the latest day. */
export const HEALTH_ALERTS_LOOKBACK_DAYS = 60;

const OTS_LOOKBACK = 30;
const SKIN_TEMP_WINDOW = 30;
const SKIN_TEMP_MIN_DAYS = 7;
const RESP_THRESHOLD = 2;
const DEBT_INFO_MIN = 45;
const DEBT_WATCH_MIN = 90;
const DEBT_ACT_MIN = 150;
const STALE_WATCH_DAYS = 2;
const STALE_ACT_DAYS = 4;
/** Metric alerts only describe "now" when the newest data is at most this old. */
const CURRENT_MAX_AGE_DAYS = 3;

const SEVERITY_RANK: Record<AlertSeverity, number> = { act: 0, watch: 1, info: 2 };

export const CHECK_LABELS: Record<AlertKind, string> = {
  freshness: "Data freshness",
  illness: "Illness signal",
  overtraining: "Overtraining",
  sleep_debt: "Sleep debt",
  hrv_low: "HRV vs baseline",
  rhr_high: "Resting HR vs baseline",
  skin_temp: "Skin temperature",
  resp_rate: "Respiratory rate",
};

const KIND_ORDER: AlertKind[] = [
  "freshness",
  "illness",
  "overtraining",
  "hrv_low",
  "rhr_high",
  "skin_temp",
  "resp_rate",
  "sleep_debt",
];

function utcMs(date: string): number {
  return Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
}

/** Whole calendar days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((utcMs(b) - utcMs(a)) / 86_400_000);
}

function isDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** Valid dates up to `today`, ascending. A row dated after the user's today
 * (server/user timezone skew) is dropped rather than treated as "latest". */
function byDate<T extends { date: string }>(rows: T[], today: string): T[] {
  return rows
    .filter((r) => isDate(r.date) && r.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Current streak: how many trailing rows satisfy `pred` on consecutive
 * calendar dates. A missing day or a failing row ends the streak.
 */
export function trailingStreak<T extends { date: string }>(
  rows: T[],
  pred: (row: T) => boolean,
): { since: string; days: number } | null {
  let i = rows.length - 1;
  if (i < 0 || !pred(rows[i])) return null;
  while (i - 1 >= 0 && pred(rows[i - 1]) && daysBetween(rows[i - 1].date, rows[i].date) === 1) {
    i--;
  }
  return { since: rows[i].date, days: daysBetween(rows[i].date, rows[rows.length - 1].date) + 1 };
}

function signed(n: number, digits: number): string {
  const s = n.toFixed(digits);
  return n >= 0 ? `+${s}` : s.replace("-", "−");
}

function fmtDuration(ms: number): string {
  const mins = Math.round(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function fmtAgo(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function computeHealthAlerts(input: HealthAlertsInput): HealthAlertsResult {
  const recovery = byDate(input.recovery, input.today);
  const sleep = byDate(input.sleep, input.today);
  const cycles = byDate(input.cycles, input.today);
  const alerts: HealthAlert[] = [];
  const status = new Map<AlertKind, CheckStatus>();

  // ── Freshness ──────────────────────────────────────────────────────────
  const latestDates = [recovery, sleep, cycles]
    .map((rows) => rows[rows.length - 1]?.date)
    .filter(isDate);
  const asOf = latestDates.length > 0 ? latestDates.sort().at(-1)! : null;

  const syncAgeH =
    input.lastSyncAt && Number.isFinite(input.lastSyncAt.getTime())
      ? Math.max(0, Math.floor((input.nowMs - input.lastSyncAt.getTime()) / 3_600_000))
      : null;
  const syncText =
    syncAgeH == null
      ? "No successful sync is on record."
      : syncAgeH < 1
        ? "Last successful sync was under an hour ago."
        : `Last successful sync was ${plural(syncAgeH, "hour")} ago.`;

  if (asOf == null) {
    alerts.push({
      kind: "freshness",
      severity: "info",
      title: "No Whoop data yet",
      detail: `There are no recovery, sleep or strain days to check. ${syncText}`,
      since: null,
      days: null,
      help: "Connect Whoop in Settings and run a sync; alerts start once a week or two of data is in.",
      href: "/settings",
    });
    status.set("freshness", "flagged");
    return finish(alerts, status, null);
  }

  const age = daysBetween(asOf, input.today);
  if (age >= STALE_WATCH_DAYS) {
    alerts.push({
      kind: "freshness",
      severity: age >= STALE_ACT_DAYS ? "act" : "watch",
      title: `Data is ${plural(age, "day")} old`,
      detail: `Your newest Whoop data is from ${asOf} (${fmtAgo(age)}). ${syncText}`,
      since: asOf,
      days: age,
      help: "Run a sync from Settings. If it keeps failing, reconnect Whoop; the other checks below only use data up to that date.",
      href: "/settings",
    });
    status.set("freshness", "flagged");
  } else {
    status.set("freshness", "clear");
  }

  // Metric checks describe the present. Past that age they'd surface a
  // weeks-old signal as current, so they report "insufficient" instead and
  // the freshness alert carries the explanation.
  if (age > CURRENT_MAX_AGE_DAYS) {
    for (const k of KIND_ORDER) if (k !== "freshness") status.set(k, "insufficient");
    return finish(alerts, status, asOf);
  }

  const isRecent = (date: string | undefined) =>
    isDate(date) && daysBetween(date, input.today) <= CURRENT_MAX_AGE_DAYS;

  // ── Illness (and the per-metric deviations it is built from) ──────────
  const illness = computeIllnessSignal(recovery, sleep);
  const latestIll: IllnessRow | undefined = illness[illness.length - 1];
  const illnessCurrent = latestIll != null && isRecent(latestIll.date) && latestIll.rhr_baseline != null;

  let illnessFired = false;
  if (!illnessCurrent) {
    status.set("illness", "insufficient");
  } else if (latestIll.illness_flag) {
    illnessFired = true;
    const streak = trailingStreak(illness, (r) => r.illness_flag)!;
    const parts: string[] = [];
    if (latestIll.rhr_flag && latestIll.rhr_dev != null)
      parts.push(`resting HR ${signed(latestIll.rhr_dev, 1)} bpm`);
    if (latestIll.hrv_flag && latestIll.hrv_dev != null)
      parts.push(`HRV ${signed(latestIll.hrv_dev, 0)}%`);
    if (latestIll.skin_temp_flag && latestIll.skin_temp_dev != null)
      parts.push(`skin temp ${signed(latestIll.skin_temp_dev, 2)} °C`);
    if (latestIll.resp_rate_flag && latestIll.resp_rate_dev != null)
      parts.push(`respiratory rate ${signed(latestIll.resp_rate_dev, 1)} br/min`);
    alerts.push({
      kind: "illness",
      severity: "act",
      title: "Early illness pattern",
      detail: `${latestIll.signal_count} of 3 signals are off your 14-day baseline: ${parts.join(", ")}.`,
      since: streak.since,
      days: streak.days,
      help: "This pattern often shows up a day or two before you feel sick. Keep strain light, prioritise sleep and fluids, and talk to a clinician if you feel unwell.",
      href: "/recovery",
    });
    status.set("illness", "flagged");
  } else {
    status.set("illness", "clear");
  }

  // ── Overtraining ───────────────────────────────────────────────────────
  const ots = computeOTS(recovery.slice(-OTS_LOOKBACK), cycles.slice(-OTS_LOOKBACK));
  const otsCurrent = isRecent(recovery[recovery.length - 1]?.date);
  if (!ots || !otsCurrent) {
    status.set("overtraining", "insufficient");
  } else if (ots.score >= 2) {
    const parts: string[] = [];
    if (ots.signals.hrv) parts.push(`HRV ${signed(ots.slopes.hrv, 2)} ms/day`);
    if (ots.signals.rhr) parts.push(`resting HR ${signed(ots.slopes.rhr, 2)} bpm/day`);
    if (ots.signals.recovery) parts.push(`recovery ${signed(ots.slopes.recovery, 2)}%/day`);
    alerts.push({
      kind: "overtraining",
      severity: ots.score === 3 ? "act" : "watch",
      title: `Overtraining score ${ots.score}/3`,
      detail: `Over your last 7 scored days ${parts.join(", ")} while strain held at ${signed(ots.slopes.strain, 2)}/day.`,
      since: null,
      days: 7,
      help: "Schedule one or two easier days (lower strain, extra sleep) and see whether the trends flatten.",
      href: "/recovery",
    });
    status.set("overtraining", "flagged");
  } else {
    status.set("overtraining", "clear");
  }

  // ── HRV below the user's own band ──────────────────────────────────────
  const hrvRows = recovery.filter((r) => r.hrv != null && Number.isFinite(r.hrv));
  const anomalies = new Map(
    detectHRVAnomalies(recovery.map((r) => ({ date: r.date, hrv: r.hrv }))).map((a) => [a.date, a]),
  );
  const latestHrv = hrvRows[hrvRows.length - 1];
  if (!latestHrv || !isRecent(latestHrv.date) || hrvRows.length < 14) {
    status.set("hrv_low", "insufficient");
  } else if (illnessFired && anomalies.has(latestHrv.date)) {
    status.set("hrv_low", "covered");
  } else {
    const streak = trailingStreak(hrvRows, (r) => anomalies.has(r.date));
    if (streak && streak.days >= 2) {
      const a = anomalies.get(latestHrv.date)!;
      alerts.push({
        kind: "hrv_low",
        severity: streak.days >= 3 ? "watch" : "info",
        title: "HRV below your usual range",
        detail: `HRV ${Math.round(latestHrv.hrv!)} ms is ${Math.round(a.pct_below)}% under your 30-day baseline of ${Math.round(a.baseline_ms)} ms, below the band for ${plural(streak.days, "day")}.`,
        since: streak.since,
        days: streak.days,
        help: "Low HRV usually tracks stress, short sleep, alcohol or hard training. A lighter day and an earlier night tend to bring it back.",
        href: "/recovery",
      });
      status.set("hrv_low", "flagged");
    } else {
      status.set("hrv_low", "clear");
    }
  }

  // ── Resting HR above baseline ──────────────────────────────────────────
  const rhrRows = illness.filter((r) => r.rhr != null && r.rhr_baseline != null);
  const latestRhr = rhrRows[rhrRows.length - 1];
  if (!latestRhr || !isRecent(latestRhr.date)) {
    status.set("rhr_high", "insufficient");
  } else if (illnessFired && latestRhr.rhr_flag) {
    status.set("rhr_high", "covered");
  } else {
    const streak = trailingStreak(rhrRows, (r) => r.rhr_flag);
    if (streak && streak.days >= 2) {
      alerts.push({
        kind: "rhr_high",
        severity: streak.days >= 3 ? "watch" : "info",
        title: "Resting HR running high",
        detail: `Resting HR ${Math.round(latestRhr.rhr!)} bpm vs your 14-day baseline of ${latestRhr.rhr_baseline!.toFixed(1)} (${signed(latestRhr.rhr_dev!, 1)} bpm), above it for ${plural(streak.days, "day")}.`,
        since: streak.since,
        days: streak.days,
        help: "Heat, late meals, alcohol, dehydration and accumulated fatigue all raise resting HR. Hydrate and keep the next session easy.",
        href: "/recovery",
      });
      status.set("rhr_high", "flagged");
    } else {
      status.set("rhr_high", "clear");
    }
  }

  // ── Skin temperature ───────────────────────────────────────────────────
  const skinWindow = recovery.slice(-SKIN_TEMP_WINDOW);
  const skinValid = skinWindow.filter((r) => r.skin_temp != null && Number.isFinite(r.skin_temp));
  const latestSkin = skinValid[skinValid.length - 1];
  if (skinValid.length < SKIN_TEMP_MIN_DAYS || !latestSkin || !isRecent(latestSkin.date)) {
    status.set("skin_temp", "insufficient");
  } else {
    const mean = skinValid.reduce((a, r) => a + r.skin_temp!, 0) / skinValid.length;
    const run = latestElevatedSkinTempRun(skinWindow, mean);
    const runDays = run ? run.runEnd - run.runStart + 1 : 0;
    const current = run != null && skinWindow[run.runEnd].date === latestSkin.date;
    if (current && runDays >= 2 && illnessFired && latestIll?.skin_temp_flag) {
      status.set("skin_temp", "covered");
    } else if (current && runDays >= 2) {
      const dev = latestSkin.skin_temp! - mean;
      alerts.push({
        kind: "skin_temp",
        severity: "watch",
        title: "Skin temperature elevated",
        detail: `Skin temp is ${signed(dev, 2)} °C over your 30-day mean of ${mean.toFixed(2)} °C, above the +${SKIN_TEMP_ELEVATED_THRESHOLD} °C line for ${plural(runDays, "day")} in a row.`,
        since: skinWindow[run!.runStart].date,
        days: runDays,
        help: "A warm room, late training or alcohol can do this; so can the start of an illness or a cycle phase. Note how you feel and watch tomorrow's reading.",
        href: "/recovery",
      });
      status.set("skin_temp", "flagged");
    } else {
      status.set("skin_temp", "clear");
    }
  }

  // ── Respiratory rate ───────────────────────────────────────────────────
  const respRows = illness.filter((r) => r.resp_rate_dev != null);
  const latestResp = respRows[respRows.length - 1];
  if (!latestResp || !isRecent(latestResp.date)) {
    status.set("resp_rate", "insufficient");
  } else {
    const off = (r: IllnessRow) => Math.abs(r.resp_rate_dev!) > RESP_THRESHOLD;
    if (illnessFired && latestIll?.resp_rate_flag) {
      status.set("resp_rate", "covered");
    } else {
      const streak = trailingStreak(respRows, off);
      if (streak) {
        const dir = latestResp.resp_rate_dev! > 0 ? "above" : "below";
        alerts.push({
          kind: "resp_rate",
          severity: streak.days >= 2 ? "watch" : "info",
          title: `Respiratory rate ${dir} baseline`,
          detail: `Sleeping respiratory rate ${latestResp.respiratory_rate!.toFixed(1)} br/min vs your 14-day baseline of ${latestResp.resp_rate_baseline!.toFixed(1)} (${signed(latestResp.resp_rate_dev!, 1)}), outside ±${RESP_THRESHOLD} for ${plural(streak.days, "night")}.`,
          since: streak.since,
          days: streak.days,
          help: "Respiratory rate is normally very stable. Congestion, altitude, alcohol or a coming illness can shift it; a single night usually settles.",
          href: "/sleep",
        });
        status.set("resp_rate", "flagged");
      } else {
        status.set("resp_rate", "clear");
      }
    }
  }

  // ── Sleep debt ─────────────────────────────────────────────────────────
  const debtRows = sleep.filter((s) => s.need_from_debt_ms != null && Number.isFinite(s.need_from_debt_ms));
  const latestDebt = debtRows[debtRows.length - 1];
  if (!latestDebt || !isRecent(latestDebt.date)) {
    status.set("sleep_debt", "insufficient");
  } else {
    const mins = latestDebt.need_from_debt_ms! / 60_000;
    if (mins >= DEBT_INFO_MIN) {
      const streak = trailingStreak(debtRows, (s) => s.need_from_debt_ms! / 60_000 >= DEBT_INFO_MIN)!;
      alerts.push({
        kind: "sleep_debt",
        severity: mins >= DEBT_ACT_MIN ? "act" : mins >= DEBT_WATCH_MIN ? "watch" : "info",
        title: `Sleep debt ${fmtDuration(latestDebt.need_from_debt_ms!)}`,
        detail: `Whoop added ${fmtDuration(latestDebt.need_from_debt_ms!)} to your sleep need for accumulated debt; it has been ${DEBT_INFO_MIN} min or more for ${plural(streak.days, "night")}.`,
        since: streak.since,
        days: streak.days,
        help: "A slightly earlier bedtime for a few nights pays debt down more reliably than one long lie-in.",
        href: "/sleep",
      });
      status.set("sleep_debt", "flagged");
    } else {
      status.set("sleep_debt", "clear");
    }
  }

  return finish(alerts, status, asOf);
}

function finish(
  alerts: HealthAlert[],
  status: Map<AlertKind, CheckStatus>,
  asOf: string | null,
): HealthAlertsResult {
  const order = (k: AlertKind) => KIND_ORDER.indexOf(k);
  alerts.sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || order(a.kind) - order(b.kind),
  );
  const checks = KIND_ORDER.map((kind) => ({
    kind,
    label: CHECK_LABELS[kind],
    status: status.get(kind) ?? "insufficient",
  }));
  return { alerts, checks, asOf };
}

/** Sidebar badge: alerts worth a glance. `info` never badges, to keep it calm. */
export function alertBadgeCount(result: HealthAlertsResult): number {
  return result.alerts.filter((a) => a.severity !== "info").length;
}
