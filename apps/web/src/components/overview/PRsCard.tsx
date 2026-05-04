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

  return (
    <section className="card" aria-label="Personal Records">
      <div className="card-head">
        <h3 className="card-title">Personal Records</h3>
      </div>
      {allEmpty ? (
        <p style={{ color: "var(--fg-3)" }}>Not enough data yet</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
          }}
        >
          {tiles.map((t) => (
            <div key={t.label}>
              <div className="card-sub">{t.label}</div>
              <div
                style={{ fontSize: 24, fontWeight: 600, marginTop: 4 }}
              >
                {t.value ?? "—"}
                <span
                  style={{
                    fontSize: 13,
                    color: "var(--fg-3)",
                    marginLeft: 4,
                    fontWeight: 400,
                  }}
                >
                  {t.unit}
                </span>
              </div>
              <div className="card-sub" style={{ marginTop: 4 }}>
                {t.sub ?? "No data"}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
