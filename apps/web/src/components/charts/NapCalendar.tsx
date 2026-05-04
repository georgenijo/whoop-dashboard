import type { NapRow } from "@/lib/db";

type Props = { naps: NapRow[] };

function formatHM(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function asleepMs(n: NapRow): number {
  return (n.light_ms ?? 0) + (n.deep_ms ?? 0) + (n.rem_ms ?? 0);
}

function startOfDayUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

export default function NapCalendar({ naps }: Props) {
  const today = startOfDayUTC(new Date());
  const gridEnd = new Date(today);
  const days: { date: string; nap: NapRow | null }[] = [];
  const napsByDate = new Map<string, NapRow>();
  for (const n of naps) napsByDate.set(n.date, n);

  for (let i = 27; i >= 0; i--) {
    const d = new Date(gridEnd);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = isoDate(d);
    days.push({ date: iso, nap: napsByDate.get(iso) ?? null });
  }

  const monthNaps = naps.filter((n) => {
    const napDate = new Date(n.date + "T00:00:00Z");
    const cutoff = new Date(today);
    cutoff.setUTCDate(cutoff.getUTCDate() - 27);
    return napDate >= cutoff;
  });
  const napCount = monthNaps.length;
  const totalNapAsleepMs = monthNaps.reduce((sum, n) => sum + asleepMs(n), 0);
  const avgNapMs = napCount > 0 ? totalNapAsleepMs / napCount : 0;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">
            <span className="dot" style={{ background: "#00d4aa", color: "#00d4aa" }} />
            Naps
          </div>
          <div className="card-sub" style={{ marginTop: 4 }}>Last 4 weeks</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 14 }}>
        <KPI label="Naps this month" value={`${napCount}`} />
        <KPI label="Avg duration" value={napCount > 0 ? formatHM(avgNapMs) : "—"} />
        <KPI label="Total nap credit" value={napCount > 0 ? formatHM(totalNapAsleepMs) : "—"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 }}>
        {WEEKDAYS.map((d, i) => (
          <div
            key={i}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9,
              color: "var(--fg-3)",
              textAlign: "center",
            }}
          >
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
        {(() => {
          // Pad start so first cell aligns with weekday of the earliest day in our 28-day window.
          const firstDate = new Date(days[0].date + "T00:00:00Z");
          const pad = firstDate.getUTCDay();
          const cells: React.ReactNode[] = [];
          for (let i = 0; i < pad; i++) {
            cells.push(<div key={`pad-${i}`} style={{ aspectRatio: "1", borderRadius: 4 }} />);
          }
          for (const d of days) {
            const nap = d.nap;
            const ms = nap ? asleepMs(nap) : 0;
            const dayNum = new Date(d.date + "T00:00:00Z").getUTCDate();
            cells.push(
              <div
                key={d.date}
                title={nap ? `${d.date}: ${formatHM(ms)}` : d.date}
                style={{
                  aspectRatio: "1",
                  borderRadius: 4,
                  background: nap ? "rgba(0,212,170,0.18)" : "transparent",
                  border: nap
                    ? "1px solid rgba(0,212,170,0.5)"
                    : "1px solid rgba(255,255,255,0.05)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 2,
                  padding: 2,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    color: nap ? "#00d4aa" : "var(--fg-3)",
                    opacity: nap ? 1 : 0.5,
                  }}
                >
                  {dayNum}
                </span>
                {nap && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 9,
                      color: "var(--fg-1)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatHM(ms)}
                  </span>
                )}
              </div>
            );
          }
          return cells;
        })()}
      </div>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-3)" }}>{label}</span>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          color: "var(--fg-1)",
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </span>
    </div>
  );
}
