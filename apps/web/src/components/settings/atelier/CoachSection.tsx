"use client";

import { useEffect, useState } from "react";

export default function CoachSection() {
  const [useApi, setUseApi] = useState(false);
  const [apiKeyPresent, setApiKeyPresent] = useState(false);
  const [serverLoaded, setServerLoaded] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState("");
  const [savedSystemPrompt, setSavedSystemPrompt] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: {
        use_api_mode: boolean;
        api_key_present: boolean;
        system_prompt: string;
        default_system_prompt: string;
      }) => {
        setUseApi(d.use_api_mode);
        setApiKeyPresent(d.api_key_present);
        setSystemPrompt(d.system_prompt);
        setSavedSystemPrompt(d.system_prompt);
        setDefaultSystemPrompt(d.default_system_prompt);
      })
      .catch(() => {})
      .finally(() => setServerLoaded(true));
  }, []);

  async function toggleApiMode(val: boolean) {
    setUseApi(val);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ use_api_mode: val }),
    });
  }

  async function saveSystemPrompt() {
    setSaving(true);
    const r = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ system_prompt: systemPrompt }),
    });
    const d = await r.json();
    setSavedSystemPrompt(d.system_prompt);
    setSaving(false);
  }

  function resetSystemPrompt() {
    setSystemPrompt(defaultSystemPrompt);
  }

  const promptDirty = systemPrompt !== savedSystemPrompt;

  return (
    <section className="atelier-coach-section">
      <div className="atelier-sec-rule">
        <span className="atelier-sec-roman">III.</span>
        <span className="atelier-sec-title">Coach</span>
      </div>

      <div className="atelier-placeholder-card" style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div>
            <div className="atelier-coach-label">Use API mode (faster)</div>
            <div className="atelier-coach-sub">
              {apiKeyPresent
                ? "Uses the Anthropic API directly. Requires ANTHROPIC_API_KEY."
                : "Set ANTHROPIC_API_KEY to enable. Currently disabled."}
            </div>
          </div>
          <button
            role="switch"
            aria-checked={useApi && apiKeyPresent}
            disabled={!serverLoaded || !apiKeyPresent}
            onClick={() => toggleApiMode(!(useApi && apiKeyPresent))}
            className="atelier-api-toggle"
            style={{
              width: 44,
              height: 24,
              borderRadius: 9999,
              border: "none",
              cursor: !serverLoaded || !apiKeyPresent ? "not-allowed" : "pointer",
              opacity: !serverLoaded || !apiKeyPresent ? 0.4 : 1,
              background: useApi && apiKeyPresent ? "var(--coral)" : "var(--line)",
              position: "relative",
              flexShrink: 0,
              transition: "background 200ms",
            }}
          >
            <span style={{
              position: "absolute",
              top: 3,
              left: useApi && apiKeyPresent ? 23 : 3,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 200ms",
              boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
            }} />
          </button>
        </div>
      </div>

      <div className="atelier-placeholder-card">
        <div className="atelier-coach-label" style={{ marginBottom: 8 }}>System prompt</div>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          spellCheck={false}
          className="atelier-coach-prompt-area"
        />
        <div style={{ display: "flex", gap: 8, marginTop: 10, justifyContent: "flex-end" }}>
          <button
            onClick={resetSystemPrompt}
            disabled={systemPrompt === defaultSystemPrompt}
            className="atelier-btn-ghost"
            style={{ opacity: systemPrompt === defaultSystemPrompt ? 0.4 : 1 }}
          >
            Reset to default
          </button>
          <button
            onClick={saveSystemPrompt}
            disabled={!promptDirty || saving}
            className="atelier-btn-primary"
            style={{ opacity: !promptDirty || saving ? 0.5 : 1 }}
          >
            {saving ? "Saving…" : promptDirty ? "Save changes" : "Saved"}
          </button>
        </div>
      </div>
    </section>
  );
}
