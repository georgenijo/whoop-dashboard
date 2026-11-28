import Link from "next/link";
import {
  DURATION_TOLERANCE,
  MIN_COMPARABLE_SEC,
  formatPace,
  type MetricComparison,
  type MetricKey,
  type SimilarWorkoutsResult,
  type ZoneMix,
} from "@/lib/analytics/similarWorkouts";

// Presentational only: the page computes `result` from one bounded scoped read.

const METRIC_LABEL: Record<MetricKey, string> = {
  avg_hr: "Avg HR",
  max_hr: "Max HR",
  strain: "Strain",
  distance_km: "Distance",
  pace_sec_per_km: "Pace",
};

function formatValue(key: MetricKey, v: number | null): string {
  if (v == null) return "—";
  switch (key) {
    case "avg_hr":
    case "max_hr":
      return `${Math.round(v)} bpm`;
    case "strain":
      return v.toFixed(1);
    case "distance_km":
      return `${v.toFixed(2)} km`;
    case "pace_sec_per_km":
      return formatPace(v);
  }
}

function formatDelta(key: MetricKey, d: number | null): string {
  if (d == null) return "";
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  const a = Math.abs(d);
  switch (key) {
    case "avg_hr":
    case "max_hr":
      return `${sign}${Math.round(a)}`;
    case "strain":
      return `${sign}${a.toFixed(1)}`;
    case "distance_km":
      return `${sign}${a.toFixed(2)}`;
    case "pace_sec_per_km": {
      const s = Math.round(a);
      return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }
  }
}

/** Rounded-to-display zero counts as no change so "+0" never shows. */
function deltaTone(key: MetricKey, d: number | null): "up" | "down" | "flat" {
  if (d == null) return "flat";
  const shown = formatDelta(key, d);
  if (/^[+−]0(\.0+)?$|^[+−]0:00$/.test(shown)) return "flat";
  return d > 0 ? "up" : d < 0 ? "down" : "flat";
}

function formatDuration(sec: number | null): string {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(date: string): string {
  return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

const VERDICT_COLOR = {
  "higher-intensity": "#f97316",
  "lower-intensity": "#06b6d4",
  typical: "var(--fg-1)",
  mixed: "#facc15",
} as const;

function Shell({ sub, children }: { sub: string; children: React.ReactNode }) {
  return (
    <section className="card" data-testid="similar-workouts-card">
      <div className="card-head">
        <div className="card-title">
          <span className="dot" style={{ background: "#a78bfa", color: "#a78bfa" }} />
          Compared with similar sessions
        </div>
        <span className="card-sub">{sub}</span>
      </div>
      {children}
    </section>
  );
}

function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="empty-state" style={{ padding: "18px 0" }}>
      <div className="title">{title}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

function ZoneBar({ mix, label }: { mix: ZoneMix; label: string }) {
  const parts = [
    { k: "easy", v: mix.easy, color: "#2563eb", name: "Z0–2" },
    { k: "moderate", v: mix.moderate, color: "#facc15", name: "Z3" },
    { k: "hard", v: mix.hard, color: "#f97316", name: "Z4–5" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "52px 1fr 92px", gap: 10, alignItems: "center" }}>
      <span className="microlabel" style={{ fontSize: 10 }}>
        {label}
      </span>
      <span
        role="img"
        aria-label={`${label}: ${parts.map((p) => `${p.name} ${Math.round(p.v)}%`).join(", ")}`}
        style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "rgba(255,255,255,0.04)" }}
      >
        {parts.map((p) =>
          p.v > 0 ? <span key={p.k} style={{ width: `${p.v}%`, background: p.color }} /> : null,
        )}
      </span>
      <span className="tnum" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-2)", textAlign: "right" }}>
        {Math.round(mix.hard)}% Z4–5
      </span>
    </div>
  );
}

function MetricRow({ m, last }: { m: MetricComparison; last: boolean }) {
  const tone = deltaTone(m.key, m.delta);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto 64px",
        gap: 12,
        alignItems: "baseline",
        padding: "8px 0",
        borderBottom: last ? undefined : "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <span className="microlabel" style={{ fontSize: 10 }}>
        {METRIC_LABEL[m.key]}
      </span>
      <span className="tnum" style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--fg-0)" }}>
        {formatValue(m.key, m.current)}
      </span>
      <span className="tnum" style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--fg-3)" }}>
        usual {formatValue(m.key, m.baseline)}
      </span>
      <span
        className="tnum"
        data-tone={tone}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11.5,
          textAlign: "right",
          color: tone === "flat" ? "var(--fg-3)" : "var(--fg-1)",
        }}
      >
        {m.delta == null ? "" : tone === "flat" ? "same" : formatDelta(m.key, m.delta)}
      </span>
    </div>
  );
}

export default function SimilarWorkoutsCard({ result }: { result: SimilarWorkoutsResult }) {
  const tol = `±${Math.round(DURATION_TOLERANCE * 100)}%`;

  if (result.status === "no-duration") {
    return (
      <Shell sub="same sport · similar length">
        <Empty title="No duration recorded" sub="Similar sessions are matched by length, so this one can't be compared." />
      </Shell>
    );
  }
  if (result.status === "too-short") {
    return (
      <Shell sub="same sport · similar length">
        <Empty
          title="Too short to compare"
          sub={`Sessions under ${MIN_COMPARABLE_SEC / 60} minutes are usually warm-ups or accidental starts.`}
        />
      </Shell>
    );
  }
  if (result.status === "first-of-sport") {
    const sport = result.sport?.trim() || "this activity";
    return (
      <Shell sub={`same sport · ${tol} length`}>
        <Empty
          title={
            result.sameSportCount === 0
              ? `Your first ${sport} session in the past year`
              : `No earlier ${sport} sessions of a similar length`
          }
          sub={
            result.sameSportCount === 0
              ? "Future sessions will be compared against this one."
              : `${result.sameSportCount} earlier ${sport} session${result.sameSportCount === 1 ? "" : "s"}, none within ${tol} of this duration.`
          }
        />
        {result.monthNote ? (
          <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 4 }}>
            {result.monthNote.kind === "longest" ? "Longest" : "Tied for longest"} {sport.toLowerCase()} this month
          </div>
        ) : null}
      </Shell>
    );
  }

  const metrics = result.metrics.filter((m) => m.current != null || m.baseline != null);
  const [headline, ...rest] = result.notes;
  const n = result.similar.length;

  return (
    <Shell sub={`vs last ${n} ${result.sport?.trim() || "similar"} session${n === 1 ? "" : "s"} · ${tol} length`}>
      <div style={{ marginBottom: 12 }}>
        <div
          data-testid="similar-verdict"
          data-verdict={result.verdict}
          style={{ fontSize: 15, fontWeight: 600, color: VERDICT_COLOR[result.verdict] }}
        >
          {headline}
        </div>
        {rest.length > 0 ? (
          <ul style={{ margin: "6px 0 0", padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {rest.map((note) => (
              <li
                key={note}
                style={{
                  fontSize: 11.5,
                  color: "var(--fg-1)",
                  padding: "2px 8px",
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.06)",
                }}
              >
                {note}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div>
        {metrics.map((m, i) => (
          <MetricRow key={m.key} m={m} last={i === metrics.length - 1} />
        ))}
      </div>

      {result.zones.current || result.zones.baseline ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
          {result.zones.current ? <ZoneBar mix={result.zones.current} label="This" /> : null}
          {result.zones.baseline ? <ZoneBar mix={result.zones.baseline} label="Usual" /> : null}
        </div>
      ) : null}

      <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 6 }}>
        {result.similar.map((w) => (
          <Link
            key={w.id}
            href={`/workouts/${w.id}`}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--fg-2)",
              padding: "3px 8px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.08)",
              textDecoration: "none",
            }}
          >
            {formatDate(w.date)} · {formatDuration(w.duration_sec)}
          </Link>
        ))}
      </div>
    </Shell>
  );
}
