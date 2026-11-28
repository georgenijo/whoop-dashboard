"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { iconForSport } from "@/components/strain/TodayWorkouts";
import { sportColor } from "@/lib/sport-color";
import {
  BAND_LABEL,
  strainBand,
  type CalendarDay,
  type StrainBand,
} from "@/lib/analytics/workoutCalendar";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_ICONS = 3;

/** Strain tint behind a day cell; the strain number is always shown too. */
export const BAND_TINT: Record<StrainBand, string> = {
  light: "rgba(255,170,0,0.07)",
  moderate: "rgba(255,170,0,0.15)",
  high: "rgba(255,170,0,0.26)",
  allout: "rgba(255,170,0,0.40)",
};

function formatMinutes(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function CellBody({ day }: { day: CalendarDay }) {
  const icons = day.sports.slice(0, MAX_ICONS);
  const extra = day.sports.length - icons.length;
  return (
    <>
      <span className="wcal-num" aria-hidden="true">{day.dayOfMonth}</span>
      {day.workouts.length > 0 && (
        <>
          <span className="wcal-icons" aria-hidden="true">
            {icons.map((s) => {
              const Icon = iconForSport(s);
              const c = sportColor(s);
              return <Icon key={s} size={13} strokeWidth={2.2} style={{ color: c }} data-sport={s} />;
            })}
            {extra > 0 && <span className="wcal-more">+{extra}</span>}
          </span>
          <span className="wcal-mins" aria-hidden="true">{formatMinutes(day.totalMinutes)}</span>
          {day.peakStrain != null && (
            <span className="wcal-strain" aria-hidden="true">{day.peakStrain.toFixed(1)}</span>
          )}
          {day.workouts.length > 1 && (
            <span className="wcal-count" aria-hidden="true">×{day.workouts.length}</span>
          )}
        </>
      )}
    </>
  );
}

export default function WorkoutCalendarGrid({ weeks }: { weeks: CalendarDay[][] }) {
  const router = useRouter();
  const days = weeks.flat();
  const initial = Math.max(
    0,
    days.findIndex((d) => d.isToday) >= 0
      ? days.findIndex((d) => d.isToday)
      : days.findIndex((d) => d.inMonth),
  );
  const [focusIdx, setFocusIdx] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const refs = useRef<(HTMLElement | null)[]>([]);

  const moveTo = useCallback(
    (idx: number) => {
      const clamped = Math.min(Math.max(idx, 0), days.length - 1);
      setFocusIdx(clamped);
      refs.current[clamped]?.focus();
    },
    [days.length],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, idx: number) => {
    const col = idx % 7;
    let next: number | null = null;
    switch (e.key) {
      case "ArrowRight": next = idx + 1; break;
      case "ArrowLeft": next = idx - 1; break;
      case "ArrowDown": next = idx + 7; break;
      case "ArrowUp": next = idx - 7; break;
      case "Home": next = e.ctrlKey ? 0 : idx - col; break;
      case "End": next = e.ctrlKey ? days.length - 1 : idx - col + 6; break;
      case "Escape":
        if (selected) {
          e.preventDefault();
          setSelected(null);
        }
        return;
      default: return;
    }
    e.preventDefault();
    moveTo(next);
  };

  const activate = (day: CalendarDay) => {
    if (day.workouts.length === 1) router.push(`/workouts/${encodeURIComponent(day.workouts[0].id)}`);
    else if (day.workouts.length > 1) setSelected(day.date === selected ? null : day.date);
  };

  const selectedDay = selected ? days.find((d) => d.date === selected) ?? null : null;

  return (
    <>
      <div role="grid" aria-label="Workout calendar" className="wcal-grid" data-testid="workout-calendar-grid">
        <div role="row" className="wcal-row">
          {WEEKDAYS.map((w) => (
            <div role="columnheader" key={w} className="wcal-head" aria-label={w}>
              {w}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div role="row" className="wcal-row" key={week[0].date}>
            {week.map((day, di) => {
              const idx = wi * 7 + di;
              const tabIndex = idx === focusIdx ? 0 : -1;
              const common = {
                ref: (el: HTMLElement | null) => {
                  refs.current[idx] = el;
                },
                tabIndex,
                "aria-label": day.label,
                title: day.label,
                onKeyDown: (e: KeyboardEvent<HTMLElement>) => onKeyDown(e, idx),
                onFocus: () => setFocusIdx(idx),
                className: [
                  "wcal-cell",
                  day.inMonth ? "" : "wcal-out",
                  day.future ? "wcal-future" : "",
                  day.isToday ? "wcal-today" : "",
                  day.workouts.length ? "wcal-active" : "",
                  selected === day.date ? "wcal-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" "),
                style: day.band ? { background: BAND_TINT[day.band] } : undefined,
                "data-date": day.date,
                "data-band": day.band ?? undefined,
                "data-sessions": day.workouts.length,
              };
              let cell;
              if (day.workouts.length === 1) {
                cell = (
                  <Link
                    {...common}
                    ref={common.ref as (el: HTMLAnchorElement | null) => void}
                    href={`/workouts/${encodeURIComponent(day.workouts[0].id)}`}
                  >
                    <CellBody day={day} />
                  </Link>
                );
              } else if (day.workouts.length > 1) {
                cell = (
                  <button
                    {...common}
                    ref={common.ref as (el: HTMLButtonElement | null) => void}
                    type="button"
                    aria-expanded={selected === day.date}
                    aria-controls="wcal-panel"
                    onClick={() => activate(day)}
                  >
                    <CellBody day={day} />
                  </button>
                );
              } else {
                cell = (
                  <span {...common} ref={common.ref as (el: HTMLSpanElement | null) => void}>
                    <CellBody day={day} />
                  </span>
                );
              }
              return (
                <div
                  role="gridcell"
                  key={day.date}
                  aria-current={day.isToday ? "date" : undefined}
                  aria-selected={selected === day.date}
                >
                  {cell}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div id="wcal-panel" aria-live="polite" data-testid="workout-calendar-panel">
        {selectedDay && (
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-head">
              <div className="card-title">
                <span className="dot" style={{ background: "#ffaa00", color: "#ffaa00" }} />
                {selectedDay.label.split(":")[0]} · {selectedDay.workouts.length} workouts
              </div>
              <button type="button" className="card-sub wcal-close" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <ul className="wcal-list">
              {selectedDay.workouts.map((w) => {
                const Icon = iconForSport(w.sport);
                const band = strainBand(w.strain);
                return (
                  <li key={w.id}>
                    <Link href={`/workouts/${encodeURIComponent(w.id)}`} className="wcal-item">
                      <Icon size={16} style={{ color: sportColor(w.sport) }} aria-hidden="true" />
                      <span className="wcal-item-sport">{w.sport}</span>
                      <span className="card-sub">{w.startTime ?? "—"}</span>
                      <span className="card-sub">{formatMinutes(w.minutes)}</span>
                      <span className="card-sub">
                        {w.strain != null ? `strain ${w.strain.toFixed(1)}${band ? ` · ${BAND_LABEL[band]}` : ""}` : "no strain"}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
