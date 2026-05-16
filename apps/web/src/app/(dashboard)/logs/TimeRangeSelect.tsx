"use client";

export type TimeRange = "1h" | "24h" | "7d" | "all";

const RANGES: { id: TimeRange; label: string }[] = [
  { id: "1h", label: "1h" },
  { id: "24h", label: "24h" },
  { id: "7d", label: "7d" },
  { id: "all", label: "All" },
];

export default function TimeRangeSelect({
  value,
  onChange,
}: {
  value: TimeRange;
  onChange: (next: TimeRange) => void;
}) {
  return (
    <div style={{ display: "inline-flex", gap: 4 }}>
      {RANGES.map((r) => {
        const active = value === r.id;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onChange(r.id)}
            style={{
              padding: "4px 12px",
              borderRadius: 6,
              border: `1px solid ${active ? "#7b61ff" : "rgba(255,255,255,0.12)"}`,
              background: active ? "#7b61ff22" : "transparent",
              color: active ? "#7b61ff" : "var(--fg-3)",
              fontSize: 12,
              fontFamily: "var(--font-sans)",
              cursor: "pointer",
            }}
            aria-pressed={active}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}
