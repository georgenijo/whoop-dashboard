"use client";

import { useEffect, useState } from "react";

type Setting = {
  key: string;
  label: string;
  description: string;
};

const SETTINGS: Setting[] = [
  {
    key: "trendline",
    label: "Line of best fit",
    description: "Overlay a linear trend line on all charts to show direction over the selected period.",
  },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 9999,
        border: "none",
        cursor: "pointer",
        background: checked ? "#7b61ff" : "rgba(255,255,255,0.08)",
        boxShadow: checked ? "0 0 12px rgba(123,97,255,0.4)" : "none",
        position: "relative",
        flexShrink: 0,
        transition: "background 200ms, box-shadow 200ms",
      }}
    >
      <span style={{
        position: "absolute",
        top: 3,
        left: checked ? 23 : 3,
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: "#fff",
        transition: "left 200ms",
        boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
      }} />
    </button>
  );
}

export default function SettingsPage() {
  const [values, setValues] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const loaded: Record<string, boolean> = {};
    for (const s of SETTINGS) {
      loaded[s.key] = localStorage.getItem(s.key) === "1";
    }
    setValues(loaded);
  }, []);

  function toggle(key: string, val: boolean) {
    localStorage.setItem(key, val ? "1" : "0");
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <div className="card">
        <div className="card-head">
          <div className="card-title">Chart preferences</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {SETTINGS.map((s, i) => (
            <div
              key={s.key}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 24,
                padding: "16px 0",
                borderTop: i > 0 ? "1px solid rgba(255,255,255,0.05)" : "none",
              }}
            >
              <div>
                <div style={{ fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500, color: "var(--fg-0)", marginBottom: 3 }}>
                  {s.label}
                </div>
                <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--fg-3)", lineHeight: 1.45 }}>
                  {s.description}
                </div>
              </div>
              <Toggle checked={!!values[s.key]} onChange={(v) => toggle(s.key, v)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
