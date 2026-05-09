import "server-only";
import { hasTable, safeQuery } from "./connection";

export type PRValue = { value: number; date: string } | null;
export type PRStreak = {
  count: number;
  start_date: string;
  end_date: string;
} | null;

export type PRStats = {
  bestHRV: PRValue;
  lowestRHR: PRValue;
  recoveryStreak: PRStreak;
  sleepPerfStreak: PRStreak;
  loggingStreak: PRStreak;
};

const MS_PER_DAY = 86_400_000;

function parseDate(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function longestStreak(dates: string[]): NonNullable<PRStreak> | null {
  if (dates.length === 0) return null;
  const sorted = Array.from(new Set(dates)).sort();
  let best = { count: 1, start_date: sorted[0], end_date: sorted[0] };
  let runStart = sorted[0];
  let runLen = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = parseDate(sorted[i - 1]);
    const curr = parseDate(sorted[i]);
    if (curr - prev === MS_PER_DAY) {
      runLen += 1;
    } else {
      runStart = sorted[i];
      runLen = 1;
    }
    if (runLen > best.count) {
      best = { count: runLen, start_date: runStart, end_date: sorted[i] };
    }
  }
  return best;
}

export function getBestHRV(): PRValue {
  return safeQuery((db) => {
    if (!hasTable(db, "recovery")) return null;
    const row = db
      .prepare(
        "SELECT date, hrv AS value FROM recovery WHERE hrv IS NOT NULL AND hrv > 0 ORDER BY hrv DESC, date DESC LIMIT 1"
      )
      .get() as { date: string; value: number } | undefined;
    return row ?? null;
  });
}

export function getLowestRHR(): PRValue {
  return safeQuery((db) => {
    if (!hasTable(db, "recovery")) return null;
    const row = db
      .prepare(
        "SELECT date, rhr AS value FROM recovery WHERE rhr IS NOT NULL AND rhr > 0 ORDER BY rhr ASC, date DESC LIMIT 1"
      )
      .get() as { date: string; value: number } | undefined;
    return row ?? null;
  });
}

export function getStreaks(): {
  recoveryStreak: PRStreak;
  sleepPerfStreak: PRStreak;
  loggingStreak: PRStreak;
} {
  const result = safeQuery((db) => {
    const hasRecovery = hasTable(db, "recovery");
    const hasSleep = hasTable(db, "sleep");

    const recoveryDates = hasRecovery
      ? (db
          .prepare(
            "SELECT date FROM recovery WHERE recovery_score >= 80 ORDER BY date ASC"
          )
          .all() as { date: string }[]).map((r) => r.date)
      : [];

    const sleepPerfDates = hasSleep
      ? (db
          .prepare(
            "SELECT date FROM sleep WHERE COALESCE(nap, 0) = 0 AND performance >= 85 ORDER BY date ASC"
          )
          .all() as { date: string }[]).map((r) => r.date)
      : [];

    let loggingDates: string[] = [];
    if (hasRecovery && hasSleep) {
      loggingDates = (db
        .prepare(
          "SELECT date FROM recovery UNION SELECT date FROM sleep WHERE COALESCE(nap, 0) = 0 ORDER BY 1 ASC"
        )
        .all() as { date: string }[]).map((r) => r.date);
    } else if (hasRecovery) {
      loggingDates = (db
        .prepare("SELECT date FROM recovery ORDER BY date ASC")
        .all() as { date: string }[]).map((r) => r.date);
    } else if (hasSleep) {
      loggingDates = (db
        .prepare("SELECT date FROM sleep WHERE COALESCE(nap, 0) = 0 ORDER BY date ASC")
        .all() as { date: string }[]).map((r) => r.date);
    }

    return {
      recoveryStreak: longestStreak(recoveryDates),
      sleepPerfStreak: longestStreak(sleepPerfDates),
      loggingStreak: longestStreak(loggingDates),
    };
  });

  return (
    result ?? {
      recoveryStreak: null,
      sleepPerfStreak: null,
      loggingStreak: null,
    }
  );
}

export function getPRStats(): PRStats {
  const streaks = getStreaks();
  return {
    bestHRV: getBestHRV(),
    lowestRHR: getLowestRHR(),
    recoveryStreak: streaks.recoveryStreak,
    sleepPerfStreak: streaks.sleepPerfStreak,
    loggingStreak: streaks.loggingStreak,
  };
}
