// "Authored by Coach / you" byline. A tiny circular monogram + label, matching
// the mock's CoachByline but using the app's theme accents.
export default function CoachByline({ createdBy }: { createdBy: "coach" | "user" }) {
  const isCoach = createdBy === "coach";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        color: "var(--fg-3)",
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 9999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: isCoach
            ? "linear-gradient(135deg, var(--success), var(--info))"
            : "rgba(255,255,255,0.12)",
          fontFamily: "var(--font-display)",
          fontSize: 10,
          fontWeight: 700,
          color: isCoach ? "#06121a" : "var(--fg-1)",
        }}
      >
        {isCoach ? "C" : "Y"}
      </span>
      {isCoach ? "Coach" : "You"}
    </span>
  );
}
