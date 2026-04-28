"use client";

import { useEffect, useState } from "react";

type LocalSetting = {
  key: string;
  label: string;
  description: string;
};

const LOCAL_SETTINGS: LocalSetting[] = [
  {
    key: "trendline",
    label: "Line of best fit",
    description: "Overlay a linear trend line on all charts to show direction over the selected period.",
  },
];

function Toggle({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 9999,
        border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
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

function Row({ label, description, children, isFirst }: { label: string; description: string; children: React.ReactNode; isFirst?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        padding: "16px 0",
        borderTop: isFirst ? "none" : "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <div>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500, color: "var(--fg-0)", marginBottom: 3 }}>
          {label}
        </div>
        <div style={{ fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--fg-3)", lineHeight: 1.45 }}>
          {description}
        </div>
      </div>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const [localValues, setLocalValues] = useState<Record<string, boolean>>({});
  const [useApi, setUseApi] = useState(false);
  const [apiKeyPresent, setApiKeyPresent] = useState(false);
  const [serverLoaded, setServerLoaded] = useState(false);

  useEffect(() => {
    const loaded: Record<string, boolean> = {};
    for (const s of LOCAL_SETTINGS) {
      loaded[s.key] = localStorage.getItem(s.key) === "1";
    }
    setLocalValues(loaded);

    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: { use_api_mode: boolean; api_key_present: boolean }) => {
        setUseApi(d.use_api_mode);
        setApiKeyPresent(d.api_key_present);
      })
      .catch(() => {})
      .finally(() => setServerLoaded(true));
  }, []);

  function toggleLocal(key: string, val: boolean) {
    localStorage.setItem(key, val ? "1" : "0");
    setLocalValues((prev) => ({ ...prev, [key]: val }));
  }

  async function toggleApiMode(val: boolean) {
    setUseApi(val);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ use_api_mode: val }),
    });
  }

  return (
    <div style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="card">
        <div className="card-head">
          <div className="card-title">Coach</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <Row
            isFirst
            label="Use API mode (faster)"
            description={
              apiKeyPresent
                ? "Uses the Anthropic API directly. Faster than the CLI fallback. Requires ANTHROPIC_API_KEY in .env.local."
                : "Set ANTHROPIC_API_KEY in .env.local on the VM to enable this. Currently disabled."
            }
          >
            <Toggle
              checked={useApi && apiKeyPresent}
              onChange={toggleApiMode}
              disabled={!serverLoaded || !apiKeyPresent}
            />
          </Row>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Chart preferences</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {LOCAL_SETTINGS.map((s, i) => (
            <Row key={s.key} isFirst={i === 0} label={s.label} description={s.description}>
              <Toggle checked={!!localValues[s.key]} onChange={(v) => toggleLocal(s.key, v)} />
            </Row>
          ))}
        </div>
      </div>
    </div>
  );
}
