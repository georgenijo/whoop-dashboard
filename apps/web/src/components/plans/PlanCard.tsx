import type { WorkoutPlan } from "@/lib/db";
import CoachByline from "./CoachByline";

type Props = { plan: WorkoutPlan };

// Compact saved-plan card: title, tag chip, active pill, description,
// created_by byline, day/exercise counts, relative updated time. The mock's
// per-plan "recovery fit %" is intentionally dropped here — it's decorative
// and not stored (locked v1 decision); today's recovery band lives in the
// banner above the list instead.
export default function PlanCard({ plan }: Props) {
  const dayCount = plan.plan.days.length;
  const exCount = plan.plan.days.reduce((n, d) => n + d.exercises.length, 0);

  return (
    <div
      className="card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        ...(plan.is_active
          ? { borderColor: "color-mix(in srgb, var(--success) 35%, transparent)" }
          : {}),
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 16,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                color: "var(--fg-0)",
              }}
            >
              {plan.title}
            </span>
            {plan.is_active && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9.5,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: "var(--success)",
                  background: "color-mix(in srgb, var(--success) 12%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--success) 40%, transparent)",
                  borderRadius: 9999,
                  padding: "2px 8px",
                }}
              >
                Active
              </span>
            )}
          </div>
          {plan.tag && (
            <div style={{ marginTop: 5 }}>
              <span
                style={{
                  fontFamily: "var(--font-sans)",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--info)",
                  background: "color-mix(in srgb, var(--info) 12%, transparent)",
                  border: "1px solid color-mix(in srgb, var(--info) 33%, transparent)",
                  borderRadius: 9999,
                  padding: "2px 9px",
                }}
              >
                {plan.tag}
              </span>
            </div>
          )}
        </div>
      </div>

      {plan.description && (
        <p
          style={{
            margin: 0,
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--fg-2)",
          }}
        >
          {plan.description}
        </p>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginTop: 2,
          paddingTop: 12,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          flexWrap: "wrap",
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          color: "var(--fg-3)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <CoachByline createdBy={plan.created_by} />
          <span style={{ fontFamily: "var(--font-mono)" }}>
            {dayCount} {dayCount === 1 ? "day" : "days"} · {exCount} {exCount === 1 ? "exercise" : "exercises"}
          </span>
        </span>
        <span>updated {relativeTime(plan.updated_at)}</span>
      </div>
    </div>
  );
}

// Compact relative-time formatter ("2d ago"). Server-rendered against the
// request time; ISO strings are UTC.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "recently";
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
