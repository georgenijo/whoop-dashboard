import Link from "next/link";
import type { ReactNode } from "react";
import {
  formatDayLong,
  formatDayShort,
  formatHm,
  type DayDetail,
  type RecoveryBand,
} from "@/lib/analytics/dayDetail";
import styles from "./day.module.css";

// Server-rendered, no client JS. The date picker is a plain GET form to
// `/day?date=…`, which redirects to `/day/<date>`, so it works without
// hydration.

const BAND_LABEL: Record<RecoveryBand, string> = { green: "Green", yellow: "Yellow", red: "Red" };
const STAGE_COLOR = { deep: "#7b61ff", rem: "#00b7ff", light: "#6f8fa8", awake: "#c9c9c9" } as const;

const dash = "—";
const fixed = (v: number | null, digits = 0, unit = "") =>
  v === null ? dash : `${v.toFixed(digits)}${unit}`;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.stat}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Section({ id, title, children, wide }: { id: string; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`card${wide ? ` ${styles.span2}` : ""}`} aria-labelledby={`day-${id}`} data-section={id}>
      <div className={styles.label} id={`day-${id}`}>
        {title}
      </div>
      {children}
    </section>
  );
}

function NavLink({ href, children, label }: { href: string | null; children: ReactNode; label: string }) {
  if (!href) {
    return (
      <span className={`${styles.btn} ${styles.disabled}`} aria-disabled="true" aria-label={label}>
        {children}
      </span>
    );
  }
  return (
    <Link className={styles.btn} href={href} aria-label={label}>
      {children}
    </Link>
  );
}

function workoutDuration(sec: number | null): string {
  return sec === null ? dash : formatHm(sec * 1000);
}

export default function DayDetailView({ day }: { day: DayDetail }) {
  const { recovery, sleep, strain, naps, workouts, journal } = day;
  return (
    <div>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>
            {formatDayLong(day.date)}
            {day.isToday ? <span className={styles.band}> · Today</span> : null}
          </h1>
          <p className={styles.recap} data-testid="day-recap">
            {day.recap}
          </p>
        </div>
        <nav className={styles.nav} aria-label="Day navigation">
          <NavLink href={`/day/${day.prevDate}`} label={`Previous day, ${formatDayShort(day.prevDate)}`}>
            ← Prev
          </NavLink>
          <NavLink
            href={day.nextDate ? `/day/${day.nextDate}` : null}
            label={day.nextDate ? `Next day, ${formatDayShort(day.nextDate)}` : "Next day (in the future)"}
          >
            Next →
          </NavLink>
          {day.pickerDates.length > 0 ? (
            <form className={styles.picker} action="/day" method="get">
              <select
                id="day-picker"
                name="date"
                aria-label="Jump to a day with data"
                className={styles.select}
                defaultValue={day.pickerDates.includes(day.date) ? day.date : undefined}>
                {day.pickerDates.map((d) => (
                  <option key={d} value={d}>
                    {formatDayShort(d)}
                  </option>
                ))}
              </select>
              <button type="submit" className={styles.btn}>
                Go
              </button>
            </form>
          ) : null}
        </nav>
      </div>

      {!day.hasAnyData ? (
        <section className="card" data-section="empty">
          <div className="empty-state">
            <div className="title">No data for this day</div>
            <div className="sub">
              {day.isToday
                ? "Today's data appears here once your Whoop syncs."
                : "Nothing was recorded or synced for this date."}
            </div>
          </div>
          {day.prevWithData || day.nextWithData ? (
            <div className={styles.nav} style={{ justifyContent: "center", marginTop: "var(--s4)" }}>
              {day.prevWithData ? (
                <Link className={styles.btn} href={`/day/${day.prevWithData}`}>
                  ← Nearest earlier: {formatDayShort(day.prevWithData)}
                </Link>
              ) : null}
              {day.nextWithData ? (
                <Link className={styles.btn} href={`/day/${day.nextWithData}`}>
                  Nearest later: {formatDayShort(day.nextWithData)} →
                </Link>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : (
        <div className={styles.grid}>
          <Section id="recovery" title="Recovery">
            {recovery ? (
              <>
                <div className={styles.big}>
                  {recovery.score === null ? dash : `${Math.round(recovery.score)}%`}
                  {recovery.band ? (
                    <span className={`${styles.band} ${styles[recovery.band]}`}>{BAND_LABEL[recovery.band]}</span>
                  ) : null}
                </div>
                <dl className={styles.stats}>
                  <Stat label="HRV" value={fixed(recovery.hrv, 0, " ms")} />
                  <Stat label="Resting HR" value={fixed(recovery.rhr, 0, " bpm")} />
                  <Stat label="Respiratory rate" value={fixed(recovery.respiratoryRate, 1, " rpm")} />
                  <Stat label="Skin temp" value={fixed(recovery.skinTemp, 1, " °C")} />
                  <Stat label="SpO₂" value={fixed(recovery.spo2, 0, "%")} />
                </dl>
              </>
            ) : (
              <p className={styles.empty}>No recovery recorded.</p>
            )}
          </Section>

          <Section id="sleep" title="Sleep">
            {sleep ? (
              <>
                <div className={styles.big}>{sleep.asleepMs === null ? dash : formatHm(sleep.asleepMs)}</div>
                <div className={styles.meta}>
                  {sleep.bedtime && sleep.wake ? `${sleep.bedtime} → ${sleep.wake}` : null}
                  {sleep.inBedMs !== null ? ` · ${formatHm(sleep.inBedMs)} in bed` : null}
                </div>
                <dl className={styles.stats}>
                  <Stat label="Performance" value={fixed(sleep.performance, 0, "%")} />
                  <Stat label="Efficiency" value={fixed(sleep.efficiency, 0, "%")} />
                  <Stat label="Consistency" value={fixed(sleep.consistency, 0, "%")} />
                  <Stat label="Disturbances" value={fixed(sleep.disturbances)} />
                  <Stat label="Sleep need" value={sleep.needMs === null ? dash : formatHm(sleep.needMs)} />
                </dl>
                {sleep.stages.length > 0 ? (
                  <>
                    <div className={styles.stages} role="img" aria-label="Sleep stages">
                      {sleep.stages.map((s) => (
                        <span key={s.key} style={{ width: `${s.pct}%`, background: STAGE_COLOR[s.key] }} />
                      ))}
                    </div>
                    <div className={styles.stageLegend}>
                      {sleep.stages.map((s) => (
                        <span key={s.key}>
                          <span aria-hidden style={{ color: STAGE_COLOR[s.key] }}>● </span>
                          {s.label} {formatHm(s.ms)}
                        </span>
                      ))}
                    </div>
                  </>
                ) : null}
                {naps.count > 0 ? (
                  <p className={styles.empty}>
                    Plus {naps.count === 1 ? "1 nap" : `${naps.count} naps`} · {formatHm(naps.totalMs)}
                  </p>
                ) : null}
              </>
            ) : naps.count > 0 ? (
              <p className={styles.empty}>
                No main sleep recorded · {naps.count === 1 ? "1 nap" : `${naps.count} naps`} ({formatHm(naps.totalMs)})
              </p>
            ) : (
              <p className={styles.empty}>No sleep recorded.</p>
            )}
          </Section>

          <Section id="strain" title="Day strain">
            {strain ? (
              <>
                <div className={styles.big}>{fixed(strain.strain, 1)}</div>
                <dl className={styles.stats}>
                  <Stat label="Calories" value={strain.kcal === null ? dash : `${strain.kcal.toLocaleString("en-US")} kcal`} />
                  <Stat label="Avg HR" value={fixed(strain.avgHr, 0, " bpm")} />
                  <Stat label="Max HR" value={fixed(strain.maxHr, 0, " bpm")} />
                </dl>
              </>
            ) : (
              <p className={styles.empty}>No strain recorded.</p>
            )}
          </Section>

          <Section id="workouts" title={`Workouts${workouts.length ? ` · ${workouts.length}` : ""}`}>
            {workouts.length > 0 ? (
              <ul className={styles.list}>
                {workouts.map((w) => (
                  <li key={w.id}>
                    <span>
                      <Link href={`/workouts/${encodeURIComponent(w.id)}`}>{w.sport}</Link>
                      {w.startTime ? <span className={styles.meta}> · {w.startTime}</span> : null}
                    </span>
                    <span className={styles.meta}>
                      {workoutDuration(w.durationSec)} · strain {fixed(w.strain, 1)}
                      {w.avgHr !== null ? ` · ${Math.round(w.avgHr)} bpm avg` : ""}
                      {w.kcal !== null ? ` · ${w.kcal} kcal` : ""}
                      {w.distanceKm !== null ? ` · ${w.distanceKm.toFixed(2)} km` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.empty}>No workouts.</p>
            )}
          </Section>

          {journal.length > 0 ? (
            <Section id="journal" title="Journal" wide>
              <ul className={styles.list}>
                {journal.map((j, i) => (
                  <li key={i} style={{ display: "block" }}>
                    {j.title ? <strong style={{ color: "var(--fg)" }}>{j.title}</strong> : null}
                    {j.mood ? <span className={styles.meta}> · mood: {j.mood}</span> : null}
                    {j.content ? <p className={styles.journalText}>{j.content}</p> : null}
                    {j.tags.length > 0 ? (
                      <div style={{ marginTop: "var(--s2)" }}>
                        {j.tags.map((t) => (
                          <span key={t} className={styles.tag}>
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      )}
    </div>
  );
}
