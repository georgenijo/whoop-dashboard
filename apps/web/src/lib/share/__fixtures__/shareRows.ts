import { addDays } from "@/lib/analytics/dayDetail";
import type {
  DayCycleInput,
  DayRecoveryInput,
  DaySleepInput,
  DayWorkoutInput,
} from "@/lib/analytics/dayDetail";
import type { TodayCardInput } from "@/lib/share/todayCard";

/** Fake rows for share-card tests. All numbers are invented. */

export const rec = (date: string, over: Partial<DayRecoveryInput> = {}): DayRecoveryInput => ({
  date,
  recovery_score: 68,
  hrv: 64,
  rhr: 52,
  spo2: 96,
  skin_temp: 33.4,
  ...over,
});

export const slp = (date: string, over: Partial<DaySleepInput> = {}): DaySleepInput => ({
  date,
  in_bed_ms: 8.2 * 3_600_000,
  light_ms: 3.9 * 3_600_000,
  deep_ms: 1.6 * 3_600_000,
  rem_ms: 2.2 * 3_600_000,
  awake_ms: 0.5 * 3_600_000,
  sleep_need_ms: 8 * 3_600_000,
  performance: 92,
  efficiency: 94,
  consistency: 81,
  disturbances: 9,
  respiratory_rate: 14.8,
  start_local: `${addDays(date, -1)}T23:04:00`,
  end_local: `${date}T07:16:00`,
  ...over,
});

export const cyc = (date: string, over: Partial<DayCycleInput> = {}): DayCycleInput => ({
  date,
  strain: 12.4,
  kilojoule: 9800,
  avg_hr: 71,
  max_hr: 168,
  ...over,
});

export const wo = (date: string, id: string, over: Partial<DayWorkoutInput> = {}): DayWorkoutInput => ({
  id,
  date,
  sport: "Running",
  duration_sec: 2700,
  avg_hr: 148,
  max_hr: 172,
  strain: 10.2,
  kilojoule: 2400,
  distance_m: 7200,
  start_utc: `${date}T11:30:00Z`,
  ...over,
});

/** `n` prior days of recovery ending the day before `date`, with HRV/RHR values. */
export function priorDays(date: string, n: number, hrv = 60, rhr = 54): DayRecoveryInput[] {
  return Array.from({ length: n }, (_, i) => rec(addDays(date, -(i + 1)), { hrv, rhr }));
}

export function input(over: Partial<TodayCardInput> = {}): TodayCardInput {
  return {
    today: "2026-11-27",
    tz: "America/New_York",
    recovery: [],
    sleep: [],
    cycles: [],
    workouts: [],
    hideNumbers: false,
    theme: "dark",
    ...over,
  };
}

/** A fully populated day with a 14-day HRV/RHR baseline. */
export function fullDay(today = "2026-11-27", over: Partial<TodayCardInput> = {}): TodayCardInput {
  return input({
    today,
    recovery: [rec(today), ...priorDays(today, 14)],
    sleep: [slp(today)],
    cycles: [cyc(today)],
    workouts: [wo(today, "w1")],
    ...over,
  });
}
