"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  GOALS_STORAGE_KEY,
  GOALS_WINDOW_DAYS,
  GOAL_KINDS,
  GOAL_SPECS,
  defaultGoalConfig,
  evaluateGoals,
  isValidValue,
  normalizeWeekStart,
  parseStoredGoals,
  serializeGoals,
  type GoalConfig,
  type GoalDayRow,
  type GoalKind,
  type GoalProgress,
  type GoalSetting,
  type GoalStatus,
  type GoalWeek,
} from "@/lib/analytics/goals";
import styles from "./goals.module.css";

// ---------------------------------------------------------------------------
// Browser-only goal storage. Nothing here touches the network or the server:
// targets live in localStorage under a versioned key and every read goes
// through `parseStoredGoals`. If storage is unavailable (private mode, blocked
// site data) the goals still work for this visit from an in-memory copy.

const listeners = new Set<() => void>();
let memoryRaw: string | null = null;
let storageBroken = false;

function readRaw(): string | null {
  if (storageBroken) return memoryRaw;
  try {
    return window.localStorage.getItem(GOALS_STORAGE_KEY);
  } catch {
    storageBroken = true;
    return memoryRaw;
  }
}

/** Returns false when the value could only be kept in memory. */
function writeRaw(raw: string | null): boolean {
  memoryRaw = raw;
  let persisted = false;
  if (!storageBroken) {
    try {
      if (raw === null) window.localStorage.removeItem(GOALS_STORAGE_KEY);
      else window.localStorage.setItem(GOALS_STORAGE_KEY, raw);
      persisted = true;
    } catch {
      storageBroken = true;
    }
  }
  for (const l of listeners) l();
  return persisted;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === GOALS_STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

/** `undefined` on the server and during hydration: "not read yet". */
const getServerSnapshot = (): string | null | undefined => undefined;

/** Test hook: forget the in-memory fallback between tests. */
export function __resetGoalsStoreForTests(): void {
  memoryRaw = null;
  storageBroken = false;
}

// ---------------------------------------------------------------------------
// Formatting

function hm(hours: number): string {
  const total = Math.round(hours * 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

function fmtValue(kind: GoalKind, v: number): string {
  switch (kind) {
    case "sleepHours":
      return hm(v);
    case "sleepPerformance":
      return `${Math.round(v)}%`;
    case "restingHr":
      return `${Math.round(v)} bpm`;
    case "weeklyStrain":
      return v.toFixed(1);
    case "workouts":
    case "recoveryDays":
      return String(Math.round(v));
  }
}

export function describeGoal(kind: GoalKind, s: GoalSetting): string {
  switch (kind) {
    case "sleepHours":
      return `Average at least ${hm(s.target)} of sleep a night`;
    case "sleepPerformance":
      return `Average sleep performance of ${s.target}% or more`;
    case "recoveryDays":
      return `Recovery of ${s.target}% or more on at least ${s.days} ${s.days === 1 ? "day" : "days"}`;
    case "workouts":
      return `At least ${s.target} ${s.target === 1 ? "workout" : "workouts"}`;
    case "weeklyStrain":
      return `Day strain adding up to ${s.target} or more`;
    case "restingHr":
      return `Average resting heart rate of ${s.target} bpm or lower`;
  }
}

function currentLine(g: GoalProgress): string {
  const v = g.current.value;
  if (v === null || g.current.daysWithData === 0) return "Nothing synced this week yet.";
  const n = g.current.daysWithData;
  const over = `${n} ${n === 1 ? "day" : "days"}`;
  switch (g.kind) {
    case "recoveryDays":
      return `${fmtValue(g.kind, v)} of ${g.setting.days} days so far`;
    case "workouts":
      return `${fmtValue(g.kind, v)} of ${g.setting.target} so far`;
    case "weeklyStrain":
      return `${fmtValue(g.kind, v)} of ${g.setting.target} so far`;
    default:
      return `${fmtValue(g.kind, v)} average over ${over}`;
  }
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const STATUS_LABEL: Record<GoalStatus, string> = {
  met: "Met",
  onTrack: "On track",
  behind: "Behind",
  noData: "No data yet",
};

function weeks(n: number): string {
  return `${n} ${n === 1 ? "week" : "weeks"}`;
}

/** "Nov 23". Formatted in UTC so the calendar day never shifts. */
function shortDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
}

function weekTitle(w: GoalWeek, isCurrent: boolean): string {
  const state = w.met ? "met" : w.noData ? "not enough data" : isCurrent ? "in progress" : "missed";
  return `Week of ${shortDate(w.start)}: ${state}`;
}

// ---------------------------------------------------------------------------
// Pieces

const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;

function Ring({ progress, status, label }: { progress: number; status: GoalStatus; label: string }) {
  const pct = Math.round(progress * 100);
  return (
    <svg
      className={styles.ring}
      viewBox="0 0 72 72"
      width={72}
      height={72}
      role="img"
      aria-label={`${label}: ${pct}% of target`}
    >
      <circle cx="36" cy="36" r={RING_R} className={styles.ringTrack} />
      <circle
        cx="36"
        cy="36"
        r={RING_R}
        className={`${styles.ringFill} ${styles[`tone_${status}`]}`}
        strokeDasharray={`${(progress * RING_C).toFixed(2)} ${RING_C.toFixed(2)}`}
        transform="rotate(-90 36 36)"
      />
      <text x="36" y="40" textAnchor="middle" className={styles.ringText}>
        {pct}%
      </text>
    </svg>
  );
}

function GoalCard({ g }: { g: GoalProgress }) {
  const id = `goal-${g.kind}`;
  const current = g.weeks.at(-1);
  return (
    <section className="card" aria-labelledby={id} data-goal={g.kind} data-status={g.status}>
      <div className={styles.cardTop}>
        <Ring progress={g.progress} status={g.status} label={g.spec.label} />
        <div className={styles.cardMain}>
          <div className={styles.label} id={id}>{g.spec.label}</div>
          <div className={styles.desc}>{describeGoal(g.kind, g.setting)}</div>
          <div className={styles.value}>{currentLine(g)}</div>
          <span className={`${styles.pill} ${styles[`tone_${g.status}`]}`}>{STATUS_LABEL[g.status]}</span>
        </div>
      </div>
      <dl className={styles.streaks}>
        <div>
          <dt>Current streak</dt>
          <dd>{weeks(g.currentStreak)}</dd>
        </div>
        <div>
          <dt>Best streak</dt>
          <dd>{weeks(g.bestStreak)}</dd>
        </div>
      </dl>
      <ol className={styles.history} aria-label={`${g.spec.label}, week by week`}>
        {g.weeks.map((w) => {
          const isCurrent = w === current;
          const cls = w.met ? styles.wMet : w.noData ? styles.wNone : isCurrent ? styles.wOpen : styles.wMiss;
          const t = weekTitle(w, isCurrent);
          return (
            <li key={w.start} className={cls} title={t}>
              <span className={styles.srOnly}>{t}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

type Draft = Record<GoalKind, { enabled: boolean; target: string; days: string }>;
type Errors = Partial<Record<`${GoalKind}.${"target" | "days"}`, string>>;

function toDraft(c: GoalConfig): Draft {
  const d = {} as Draft;
  for (const k of GOAL_KINDS) {
    d[k] = { enabled: c[k].enabled, target: String(c[k].target), days: String(c[k].days ?? "") };
  }
  return d;
}

function rangeMessage(r: { min: number; max: number; step: number }): string {
  const step = r.step === 1 ? "a whole number" : `a multiple of ${r.step}`;
  return `Enter ${step} from ${r.min} to ${r.max}.`;
}

/** Validate a draft. Disabled goals keep their stored values untouched. */
export function validateDraft(draft: Draft, base: GoalConfig): { config: GoalConfig; errors: Errors } {
  const config = { ...base };
  const errors: Errors = {};
  for (const k of GOAL_KINDS) {
    const spec = GOAL_SPECS[k];
    const d = draft[k];
    if (!d.enabled) {
      config[k] = { ...base[k], enabled: false };
      continue;
    }
    const target = d.target.trim() === "" ? Number.NaN : Number(d.target);
    if (!isValidValue(target, spec.target)) errors[`${k}.target`] = rangeMessage(spec.target);
    let days: number | undefined;
    if (spec.days) {
      days = d.days.trim() === "" ? Number.NaN : Number(d.days);
      if (!isValidValue(days, spec.days)) errors[`${k}.days`] = rangeMessage(spec.days);
    }
    if (!errors[`${k}.target`] && !errors[`${k}.days`]) {
      config[k] = spec.days ? { enabled: true, target, days } : { enabled: true, target };
    }
  }
  return { config, errors };
}

const TARGET_LABEL: Record<GoalKind, string> = {
  sleepHours: "Hours a night (average)",
  sleepPerformance: "Sleep performance % (average)",
  recoveryDays: "Recovery at least (%)",
  workouts: "Workouts a week",
  weeklyStrain: "Total day strain a week",
  restingHr: "Resting HR at most (bpm, average)",
};

function GoalForm({
  config,
  onSave,
  onReset,
}: {
  config: GoalConfig;
  onSave: (c: GoalConfig) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(config));
  const [errors, setErrors] = useState<Errors>({});

  const set = (k: GoalKind, patch: Partial<Draft[GoalKind]>) =>
    setDraft((d) => ({ ...d, [k]: { ...d[k], ...patch } }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const res = validateDraft(draft, config);
    setErrors(res.errors);
    if (Object.keys(res.errors).length === 0) onSave(res.config);
  };

  const errorCount = Object.keys(errors).length;

  return (
    <form className={`card ${styles.form}`} onSubmit={submit} noValidate aria-labelledby="goals-edit">
      <div className="card-title" id="goals-edit">Edit goals</div>
      <p className={styles.formNote}>
        Goals are saved in this browser only — they aren&apos;t sent anywhere or shared with your other devices.
      </p>
      {errorCount > 0 && (
        <p className={styles.formError} role="alert">
          Fix {errorCount === 1 ? "the highlighted field" : `${errorCount} highlighted fields`} to save.
        </p>
      )}
      <div className={styles.fields}>
        {GOAL_KINDS.map((k) => {
          const spec = GOAL_SPECS[k];
          const d = draft[k];
          const tErr = errors[`${k}.target`];
          const dErr = errors[`${k}.days`];
          return (
            <fieldset key={k} className={styles.fieldset}>
              <legend className={styles.legend}>
                <label>
                  <input
                    type="checkbox"
                    checked={d.enabled}
                    onChange={(e) => set(k, { enabled: e.target.checked })}
                  />{" "}
                  {spec.label}
                </label>
              </legend>
              <div className={styles.inputs}>
                <div className={styles.field}>
                  <label htmlFor={`goal-${k}-target`}>{TARGET_LABEL[k]}</label>
                  <input
                    id={`goal-${k}-target`}
                    name={`${k}.target`}
                    type="number"
                    inputMode="decimal"
                    min={spec.target.min}
                    max={spec.target.max}
                    step={spec.target.step}
                    value={d.target}
                    disabled={!d.enabled}
                    required={d.enabled}
                    aria-invalid={tErr ? true : undefined}
                    aria-describedby={tErr ? `goal-${k}-target-err` : `goal-${k}-target-hint`}
                    onChange={(e) => set(k, { target: e.target.value })}
                  />
                  {tErr ? (
                    <span className={styles.fieldError} id={`goal-${k}-target-err`}>{tErr}</span>
                  ) : (
                    <span className={styles.hint} id={`goal-${k}-target-hint`}>
                      {spec.target.min}–{spec.target.max}
                    </span>
                  )}
                </div>
                {spec.days && (
                  <div className={styles.field}>
                    <label htmlFor={`goal-${k}-days`}>Days a week</label>
                    <input
                      id={`goal-${k}-days`}
                      name={`${k}.days`}
                      type="number"
                      inputMode="numeric"
                      min={spec.days.min}
                      max={spec.days.max}
                      step={spec.days.step}
                      value={d.days}
                      disabled={!d.enabled}
                      required={d.enabled}
                      aria-invalid={dErr ? true : undefined}
                      aria-describedby={dErr ? `goal-${k}-days-err` : `goal-${k}-days-hint`}
                      onChange={(e) => set(k, { days: e.target.value })}
                    />
                    {dErr ? (
                      <span className={styles.fieldError} id={`goal-${k}-days-err`}>{dErr}</span>
                    ) : (
                      <span className={styles.hint} id={`goal-${k}-days-hint`}>
                        {spec.days.min}–{spec.days.max}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary}>Save goals</button>
        <button type="button" className={styles.secondary} onClick={onReset}>
          Reset to defaults
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

export default function GoalsView({
  rows,
  today,
  weekStart,
}: {
  rows: GoalDayRow[];
  today: string;
  weekStart: number;
}) {
  const ws = normalizeWeekStart(weekStart);
  const raw = useSyncExternalStore(subscribe, readRaw, getServerSnapshot);
  const [notice, setNotice] = useState<string | null>(null);
  const loaded = raw !== undefined;
  const config = useMemo(() => (loaded ? parseStoredGoals(raw) : defaultGoalConfig()), [loaded, raw]);
  const results = useMemo(
    () => evaluateGoals({ rows, today, config, weekStart: ws }),
    [rows, today, config, ws],
  );

  const save = (c: GoalConfig) => {
    const ok = writeRaw(serializeGoals(c));
    setNotice(ok ? "Goals saved." : "Saved for this visit only — this browser isn't allowing site storage.");
  };
  const reset = () => {
    const ok = writeRaw(null);
    setNotice(ok ? "Goals reset to the defaults." : "Reset for this visit only — this browser isn't allowing site storage.");
  };

  const counts = results.reduce<Record<GoalStatus, number>>(
    (acc, g) => ({ ...acc, [g.status]: acc[g.status] + 1 }),
    { met: 0, onTrack: 0, behind: 0, noData: 0 },
  );

  return (
    <div>
      <p className={styles.intro}>
        Weekly targets checked against your own Whoop data. Weeks run {DAY_NAMES[ws]} to{" "}
        {DAY_NAMES[(ws + 6) % 7]}; streaks count
        consecutive weeks met within the last {GOALS_WINDOW_DAYS} days. As of {shortDate(today)}.
      </p>
      {rows.length === 0 && (
        <p className={styles.empty}>No Whoop data in the last {GOALS_WINDOW_DAYS} days yet. Goals fill in once data syncs.</p>
      )}
      <div role="status" aria-live="polite" className={styles.notice}>{notice}</div>
      {!loaded ? (
        <p className={styles.empty} data-testid="goals-loading">Loading your goals…</p>
      ) : (
        <>
          {results.length > 0 ? (
            <p className={styles.summary} data-testid="goals-summary">
              This week: {counts.met} met · {counts.onTrack} on track · {counts.behind} behind
              {counts.noData > 0 ? ` · ${counts.noData} waiting for data` : ""}
            </p>
          ) : (
            <p className={styles.empty}>No goals are turned on. Pick some below.</p>
          )}
          <div className={styles.grid}>
            {results.map((g) => (
              <GoalCard key={g.kind} g={g} />
            ))}
          </div>
          <GoalForm key={raw ?? "defaults"} config={config} onSave={save} onReset={reset} />
        </>
      )}
    </div>
  );
}
