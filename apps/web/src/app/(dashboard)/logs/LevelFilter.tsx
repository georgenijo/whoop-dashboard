"use client";

import type { EventLevel } from "@/lib/db/events";

const LEVELS: { id: EventLevel; label: string; color: string }[] = [
  { id: "info", label: "Info", color: "#94a3b8" },
  { id: "warn", label: "Warn", color: "#f59e0b" },
  { id: "error", label: "Error", color: "#ef4444" },
  { id: "fatal", label: "Fatal", color: "#dc2626" },
];

export const LEVEL_COLORS: Record<EventLevel, string> = LEVELS.reduce(
  (acc, l) => {
    acc[l.id] = l.color;
    return acc;
  },
  {} as Record<EventLevel, string>,
);

export default function LevelFilter({
  value,
  onChange,
}: {
  value: Set<EventLevel>;
  onChange: (next: Set<EventLevel>) => void;
}) {
  function toggle(id: EventLevel) {
    const next = new Set(value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }
  return (
    <div style={{ display: "inline-flex", gap: 4 }}>
      {LEVELS.map((l) => {
        const active = value.has(l.id);
        return (
          <button
            key={l.id}
            type="button"
            onClick={() => toggle(l.id)}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: `1px solid ${active ? l.color : "rgba(255,255,255,0.12)"}`,
              background: active ? `${l.color}22` : "transparent",
              color: active ? l.color : "var(--fg-3)",
              fontSize: 12,
              fontFamily: "var(--font-sans)",
              cursor: "pointer",
            }}
            aria-pressed={active}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
