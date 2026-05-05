"use client";

import { useEffect, useState } from "react";
import type { Theme } from "@/app/theme-cookie";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("classic");

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === "atelier" ? "atelier" : "classic");
  }, []);

  async function toggle() {
    const next: Theme = theme === "atelier" ? "classic" : "atelier";
    // Optimistic update
    if (next === "atelier") {
      document.documentElement.dataset.theme = "atelier";
      document.documentElement.style.colorScheme = "light";
    } else {
      delete document.documentElement.dataset.theme;
      document.documentElement.style.colorScheme = "dark";
    }
    setTheme(next);
    await fetch("/api/theme", { method: "POST", body: next });
  }

  const isAtelier = theme === "atelier";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        userSelect: "none",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          color: isAtelier ? "var(--fg-3)" : "var(--fg-0)",
          fontWeight: isAtelier ? 400 : 600,
          transition: "color 200ms",
        }}
      >
        Classic
      </span>
      <button
        role="switch"
        aria-checked={isAtelier}
        onClick={toggle}
        style={{
          width: 44,
          height: 24,
          borderRadius: 9999,
          border: "none",
          cursor: "pointer",
          background: isAtelier ? "#ed6f5c" : "rgba(255,255,255,0.12)",
          boxShadow: isAtelier
            ? "0 0 12px rgba(237,111,92,0.4)"
            : "none",
          position: "relative",
          flexShrink: 0,
          transition: "background 200ms, box-shadow 200ms",
          padding: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: isAtelier ? 23 : 3,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: "#fff",
            transition: "left 200ms",
            boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
          }}
        />
      </button>
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          color: isAtelier ? "var(--fg-0)" : "var(--fg-3)",
          fontWeight: isAtelier ? 600 : 400,
          transition: "color 200ms",
        }}
      >
        Atelier
      </span>
    </div>
  );
}
