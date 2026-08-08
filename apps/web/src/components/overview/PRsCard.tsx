import type { PRStats, PRStreak, PRValue } from "@/lib/db";

type Tile = {
  label: string;
  value: string | null;
  unit: string;
  sub: string | null;
};

function fromValue(label: string, unit: string, pr: PRValue): Tile {
  if (!pr) return { label, value: null, unit, sub: null };
  return {
    label,
    value: Math.round(pr.value).toString(),
    unit,
    sub: pr.date,
  };
}

function fromStreak(label: string, streak: PRStreak): Tile {
  if (!streak) return { label, value: null, unit: "days", sub: null };
  const sub =
    streak.start_date === streak.end_date
      ? streak.start_date
      : `${streak.start_date} → ${streak.end_date}`;
  return {
    label,
    value: streak.count.toString(),
    unit: streak.count === 1 ? "day" : "days",
    sub,
  };
}

export default function PRsCard({ stats }: { stats: PRStats }) {
  const tiles: Tile[] = [
    fromValue("Highest HRV", "ms", stats.bestHRV),
    fromValue("Lowest RHR", "bpm", stats.lowestRHR),
    fromStreak("Recovery ≥80% streak", stats.recoveryStreak),
    fromStreak("Sleep perf ≥85% streak", stats.sleepPerfStreak),
    fromStreak("Logging streak", stats.loggingStreak),
  ];

  const allEmpty = tiles.every((t) => t.value === null);
  const recordCount = tiles.filter((t) => t.value !== null).length;

  return (
    <section className="overview-detail" aria-label="Detail">
      <span className="overview-kicker">Detail</span>
      <details className="overview-disclosure">
        <summary>
          <span>Personal records</span>
          <span className="overview-disclosure-meta">
            {allEmpty ? "Not enough data yet" : `${recordCount} tracked records`}
          </span>
          <span className="overview-disclosure-chevron" aria-hidden />
        </summary>
        <div className="overview-disclosure-body">
          {allEmpty ? (
            <p className="overview-empty-copy">Not enough data yet</p>
          ) : (
            <div className="overview-record-grid">
              {tiles.map((t) => (
                <div className="overview-record" key={t.label}>
                  <div className="card-sub">{t.label}</div>
                  <div className="overview-record-value">
                    {t.value ?? "—"}
                    <span>{t.unit}</span>
                  </div>
                  <div className="card-sub">{t.sub ?? "No data"}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
