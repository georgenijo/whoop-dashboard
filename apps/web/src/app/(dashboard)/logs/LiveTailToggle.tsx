"use client";

export default function LiveTailToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 6,
        border: `1px solid ${value ? "#10b981" : "rgba(255,255,255,0.12)"}`,
        background: value ? "#10b98122" : "transparent",
        color: value ? "#10b981" : "var(--fg-3)",
        fontSize: 12,
        fontFamily: "var(--font-sans)",
        cursor: "pointer",
      }}
      aria-pressed={value}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: value ? "#10b981" : "rgba(255,255,255,0.2)",
          animation: value ? "pulse 1.6s ease-in-out infinite" : "none",
        }}
      />
      Live tail
    </button>
  );
}
