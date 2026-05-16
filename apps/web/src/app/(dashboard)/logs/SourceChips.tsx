"use client";

import type { EventSource } from "@/lib/db/events";

const SOURCES: { id: EventSource; label: string; color: string }[] = [
  { id: "server", label: "Server", color: "#94a3b8" },
  { id: "web", label: "Web", color: "#60a5fa" },
  { id: "ios", label: "iOS", color: "#c084fc" },
  { id: "sync", label: "Sync", color: "#10b981" },
  { id: "coach", label: "Coach", color: "#f59e0b" },
  { id: "webhook", label: "Webhook", color: "#f472b6" },
  { id: "route", label: "Route", color: "#22d3ee" },
];

export const SOURCE_COLORS: Record<EventSource, string> = SOURCES.reduce(
  (acc, s) => {
    acc[s.id] = s.color;
    return acc;
  },
  {} as Record<EventSource, string>,
);
export const SOURCE_LABELS: Record<EventSource, string> = SOURCES.reduce(
  (acc, s) => {
    acc[s.id] = s.label;
    return acc;
  },
  {} as Record<EventSource, string>,
);

export default function SourceChips({
  value,
  onChange,
}: {
  value: Set<EventSource>;
  onChange: (next: Set<EventSource>) => void;
}) {
  function toggle(id: EventSource) {
    const next = new Set(value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {SOURCES.map((s) => {
        const active = value.has(s.id);
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => toggle(s.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 999,
              border: `1px solid ${active ? s.color : "rgba(255,255,255,0.12)"}`,
              background: active ? `${s.color}22` : "transparent",
              color: active ? s.color : "var(--fg-2)",
              fontSize: 12,
              fontFamily: "var(--font-sans)",
              cursor: "pointer",
              transition: "all 0.12s",
            }}
            aria-pressed={active}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: s.color,
                opacity: active ? 1 : 0.5,
              }}
            />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
