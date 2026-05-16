type Props = {
  latestDate: string | null;
  today: string;
};

export default function FreshnessBanner({ latestDate, today }: Props) {
  if (!latestDate) return null;
  const a = new Date(latestDate + "T00:00:00");
  const b = new Date(today + "T00:00:00");
  const days = Math.round((b.getTime() - a.getTime()) / 86400000);
  if (days < 1) return null;
  const friendly = a.toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        marginBottom: 16,
        background: "rgba(255,170,0,0.08)",
        border: "1px solid rgba(255,170,0,0.32)",
        borderRadius: 8,
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color: "#ffaa00",
        letterSpacing: "0.02em",
      }}
    >
      <span style={{ fontSize: 12 }}>⚠</span>
      <span>
        Last synced {friendly} · {days} day{days === 1 ? "" : "s"} ago
      </span>
    </div>
  );
}
