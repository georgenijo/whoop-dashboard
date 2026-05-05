"use client";

import { useEffect, useState } from "react";
import type { Theme } from "@/app/theme-cookie";
import ThemeToggle from "@/components/ThemeToggle";

type ThemeCardProps = { variant: "classic" | "zero"; active: boolean };

function ThemeCard({ variant, active }: ThemeCardProps) {
  const isZero = variant === "zero";
  return (
    <div
      className={`atelier-theme-card ${variant}${active ? " is-active" : ""}`}
      style={{
        background: isZero ? "#efe7d2" : "#000000",
        border: active ? "2px solid var(--coral)" : "2px solid transparent",
        borderRadius: 6,
        padding: "16px 20px",
        flex: 1,
        minWidth: 0,
        transition: "border-color 200ms",
      }}
    >
      <div className="atelier-swatch-row" style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {isZero ? (
          <>
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#efe7d2", border: "1px solid rgba(21,20,15,0.2)", display: "inline-block" }} />
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#ed6f5c", display: "inline-block" }} />
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#e9b94a", display: "inline-block" }} />
          </>
        ) : (
          <>
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#000000", border: "1px solid rgba(255,255,255,0.2)", display: "inline-block" }} />
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#7b61ff", display: "inline-block" }} />
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#ff0043", display: "inline-block" }} />
          </>
        )}
      </div>
      <div
        style={{
          fontFamily: isZero ? "Georgia, serif" : "var(--font-mono)",
          fontSize: 28,
          fontWeight: isZero ? 400 : 300,
          color: isZero ? "#15140f" : "#ffffff",
          lineHeight: 1,
          marginBottom: 6,
          letterSpacing: isZero ? "-0.01em" : "-0.02em",
        }}
      >
        72
      </div>
      <div
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: isZero ? "#5a5448" : "rgba(255,255,255,0.5)",
        }}
      >
        {isZero ? "Atelier Zero" : "Classic"}
      </div>
    </div>
  );
}

export default function ThemeStage({ initialTheme }: { initialTheme: Theme }) {
  const [active, setActive] = useState<Theme>(initialTheme);

  useEffect(() => {
    const obs = new MutationObserver(() => {
      const next = document.documentElement.dataset.theme === "atelier" ? "atelier" : "classic";
      setActive(next);
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

  return (
    <section className="atelier-theme-stage">
      <div className="atelier-sec-rule">
        <span className="atelier-sec-roman">I.</span>
        <span className="atelier-sec-title">Visual Theme</span>
      </div>
      <p className="atelier-sec-sub">
        Pick a <em>surface</em>. Coach reads either.
      </p>
      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <ThemeCard variant="classic" active={active === "classic"} />
        <ThemeCard variant="zero" active={active === "atelier"} />
      </div>
      <div className="atelier-theme-switch">
        <ThemeToggle />
      </div>
    </section>
  );
}
