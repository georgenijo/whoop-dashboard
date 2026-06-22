import type { PlanDay, WorkoutPlan } from "@/lib/db";
import { intensityColor, intensityLabel } from "./band";
import CoachByline from "./CoachByline";

type Props = { plan: WorkoutPlan };

// One plan expanded: header + days (each a card of exercises) + the Coach's
// "why" rationale. READ-ONLY (v1 scope — no per-exercise check-off / finish).
export default function PlanDetail({ plan }: Props) {
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title" style={{ flexWrap: "wrap" }}>
            {plan.title}
            {plan.is_active && <ActivePill />}
          </div>
          <div
            className="card-sub"
            style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
          >
            <CoachByline createdBy={plan.created_by} />
            {plan.tag && <Tag tag={plan.tag} />}
          </div>
        </div>
      </div>

      {plan.description && (
        <p
          style={{
            margin: "0 0 16px",
            fontFamily: "var(--font-sans)",
            fontSize: 13.5,
            lineHeight: 1.55,
            color: "var(--fg-2)",
          }}
        >
          {plan.description}
        </p>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 14,
        }}
      >
        {plan.plan.days.map((day, i) => (
          <DayPanel key={`${day.name}-${i}`} day={day} />
        ))}
      </div>

      {plan.plan.why && (
        <div
          style={{
            marginTop: 16,
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderLeft: "3px solid var(--success)",
            borderRadius: 12,
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--success)",
              fontWeight: 700,
              marginBottom: 6,
            }}
          >
            Why this prescription
          </div>
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-sans)",
              fontSize: 13.5,
              lineHeight: 1.6,
              color: "var(--fg-2)",
            }}
          >
            {plan.plan.why}
          </p>
        </div>
      )}
    </div>
  );
}

function DayPanel({ day }: { day: PlanDay }) {
  const color = intensityColor(day.intensity);
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 14,
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 9999,
              background: color,
              boxShadow: `0 0 8px color-mix(in srgb, ${color} 40%, transparent)`,
              flex: "none",
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 15,
                fontWeight: 600,
                color: "var(--fg-0)",
              }}
            >
              {day.name}
            </div>
            {day.focus && (
              <div style={{ fontSize: 11, color: "var(--fg-3)" }}>{day.focus}</div>
            )}
          </div>
        </div>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color,
            background: `color-mix(in srgb, ${color} 12%, transparent)`,
            border: `1px solid color-mix(in srgb, ${color} 33%, transparent)`,
            borderRadius: 9999,
            padding: "3px 10px",
            flex: "none",
          }}
        >
          {intensityLabel(day.intensity)}
        </span>
      </div>

      {day.exercises.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "var(--fg-3)", padding: "6px 0" }}>
          Rest day
        </div>
      ) : (
        <div>
          {day.exercises.map((ex, i) => (
            <div
              key={`${ex.name}-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "9px 0",
                borderBottom:
                  i === day.exercises.length - 1
                    ? "none"
                    : "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span style={{ fontSize: 13, color: "var(--fg-1)" }}>
                {ex.name}
                {ex.note && (
                  <span style={{ color: "var(--fg-3)", fontSize: 11.5 }}> · {ex.note}</span>
                )}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12.5,
                  color: "var(--fg-2)",
                  whiteSpace: "nowrap",
                }}
              >
                {ex.scheme}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActivePill() {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--success)",
        background: "color-mix(in srgb, var(--success) 12%, transparent)",
        border: "1px solid color-mix(in srgb, var(--success) 40%, transparent)",
        borderRadius: 9999,
        padding: "3px 9px",
      }}
    >
      Active
    </span>
  );
}

function Tag({ tag }: { tag: string }) {
  return (
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
      {tag}
    </span>
  );
}
