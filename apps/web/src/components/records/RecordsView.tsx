import type { PRStats, PRStreak } from "@/lib/db";
import type { RecordBoardRow, RecordEntry, RecordMetricKey } from "@/lib/analytics/records";
import { TYPICAL_WINDOW_DAYS } from "@/lib/analytics/records";
import styles from "./records.module.css";

// Server-rendered, no client JS: the page is a static readout of the board.

function hm(totalMinutes: number): string {
  const m = Math.round(totalMinutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}h ${r.toString().padStart(2, "0")}m` : `${r}m`;
}

export function formatRecordValue(key: RecordMetricKey, v: number): string {
  switch (key) {
    case "hrv":
      return `${Math.round(v)} ms`;
    case "rhr":
      return `${Math.round(v)} bpm`;
    case "recovery":
    case "sleepPerformance":
      return `${Math.round(v)}%`;
    case "strain":
      return v.toFixed(1);
    case "sleepDuration":
      return hm(v / 60_000);
    case "workoutDuration":
      return hm(v / 60);
    case "steps":
      return Math.round(v).toLocaleString("en-US");
  }
}

/** Calendar date → "Nov 3, 2026". Formatted in UTC so the day never shifts. */
export function formatRecordDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function sinceText(days: number | null, entry: RecordEntry): string {
  if (days === null) return "";
  const when = days === 0 ? "today" : days === 1 ? "1 day ago" : `${days.toLocaleString("en-US")} days ago`;
  const verb = entry.ties > 0 ? "Last matched" : "Set";
  return `${verb} ${when}`;
}

function compareText(row: RecordBoardRow): string {
  const h = row.history;
  if (h.typical === null || h.deltaVsTypical === null) {
    return `No readings in the last ${TYPICAL_WINDOW_DAYS} days to compare against.`;
  }
  const typical = formatRecordValue(row.key, h.typical);
  const n = `${h.typicalSamples} ${h.typicalSamples === 1 ? "day" : "days"}`;
  if (h.deltaVsTypical === 0) return `Right at your ${TYPICAL_WINDOW_DAYS}-day typical (${typical}, ${n}).`;
  const side = h.deltaVsTypical > 0 ? "above" : "below";
  const pct = h.deltaPctVsTypical === null ? "" : ` (${Math.abs(Math.round(h.deltaPctVsTypical))}%)`;
  return `${formatRecordValue(row.key, Math.abs(h.deltaVsTypical))}${pct} ${side} your ${TYPICAL_WINDOW_DAYS}-day typical of ${typical} (median of ${n}).`;
}

function RecordTile({ row }: { row: RecordBoardRow }) {
  const h = row.history;
  const cur = h.current;
  return (
    <section className="card" aria-labelledby={`rec-${row.key}`} data-record={row.key}>
      <div className={styles.label} id={`rec-${row.key}`}>{row.label}</div>
      {!cur ? (
        <p className={styles.empty}>No data yet.</p>
      ) : (
        <>
          <div className={styles.value}>
            {formatRecordValue(row.key, cur.value)}
            {cur.note ? <span className={styles.note}>{cur.note}</span> : null}
          </div>
          <div className={styles.meta}>
            {formatRecordDate(cur.setOn)}
            {cur.ties > 0
              ? ` · matched ${cur.ties} more ${cur.ties === 1 ? "time" : "times"}, latest ${formatRecordDate(cur.lastMatchedOn)}`
              : ""}
          </div>
          <div className={styles.since}>{sinceText(h.daysSinceRecord, cur)}</div>
          <div className={styles.compare}>{compareText(row)}</div>
          {h.previous.length === 0 ? (
            <p className={styles.empty}>
              {h.days === 1 ? "First reading — the record to beat." : "Your first reading still stands."}
            </p>
          ) : (
            <ol className={styles.history} aria-label={`Previous ${row.label.toLowerCase()} records`}>
              {h.previous.map((p) => (
                <li key={p.setOn}>
                  <span>{formatRecordValue(row.key, p.value)}{p.note ? ` · ${p.note}` : ""}</span>
                  <span>{formatRecordDate(p.setOn)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

function StreakTile({ label, streak }: { label: string; streak: PRStreak }) {
  return (
    <div>
      <div className={styles.label}>{label}</div>
      {streak ? (
        <>
          <div className={styles.value}>
            {streak.count} <span className={styles.note}>{streak.count === 1 ? "day" : "days"}</span>
          </div>
          <div className={styles.meta}>
            {streak.start_date === streak.end_date
              ? formatRecordDate(streak.start_date)
              : `${formatRecordDate(streak.start_date)} → ${formatRecordDate(streak.end_date)}`}
          </div>
        </>
      ) : (
        <p className={styles.empty}>No data yet.</p>
      )}
    </div>
  );
}

export default function RecordsView({
  board,
  streaks,
  today,
}: {
  board: RecordBoardRow[];
  streaks: Pick<PRStats, "recoveryStreak" | "sleepPerfStreak" | "loggingStreak">;
  today: string;
}) {
  const tracked = board.filter((r) => r.history.current).length;
  return (
    <div>
      <p className={styles.intro}>
        {tracked === 0
          ? "No records yet. Records appear here once Whoop data has synced."
          : `Your all-time bests across ${tracked} ${tracked === 1 ? "metric" : "metrics"}, each with the records it replaced and how it compares with a normal day lately. As of ${formatRecordDate(today)}.`}
      </p>
      <div className={styles.grid}>
        {board.map((row) => (
          <RecordTile key={row.key} row={row} />
        ))}
      </div>
      <section className="card" style={{ marginTop: "var(--s8)" }} aria-labelledby="rec-streaks">
        <div className="card-title" id="rec-streaks">Streak records</div>
        <div className={styles.streaks}>
          <StreakTile label="Recovery ≥80%" streak={streaks.recoveryStreak} />
          <StreakTile label="Sleep perf ≥85%" streak={streaks.sleepPerfStreak} />
          <StreakTile label="Logging" streak={streaks.loggingStreak} />
        </div>
      </section>
    </div>
  );
}
