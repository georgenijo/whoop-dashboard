"use client";

import { useCallback, useEffect, useState } from "react";

type LocalSetting = {
  key: string;
  label: string;
  description: string;
};

type WhoopConnectorStatus = "connected" | "needs_reconnect" | "disconnected";

type WhoopConnector = {
  provider: "whoop";
  status: WhoopConnectorStatus;
  expires_at: string | null;
  scope: string | null;
  source: "db" | "file" | null;
  last_sync_at: string | null;
};

const CONNECTOR_STATUS_COPY: Record<WhoopConnectorStatus, { label: string; color: string }> = {
  connected: { label: "Connected", color: "#4ade80" },
  needs_reconnect: { label: "Needs reconnect", color: "#fbbf24" },
  disconnected: { label: "Disconnected", color: "rgba(255,255,255,0.4)" },
};

function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diffMs = Date.now() - t;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

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
  const [systemPrompt, setSystemPrompt] = useState("");
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState("");
  const [savedSystemPrompt, setSavedSystemPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [whoop, setWhoop] = useState<WhoopConnector | null>(null);
  const [whoopWorking, setWhoopWorking] = useState(false);

  const refreshWhoop = useCallback(() => {
    // Promise chain (not async/await) so the function returns synchronously
    // — the eslint rule react-hooks/set-state-in-effect flags only the
    // synchronous `setState` calls during effect setup, and an unawaited
    // chain qualifies as side-effectful, not effect-body work.
    fetch("/api/connectors/whoop")
      .then((r) => (r.ok ? (r.json() as Promise<WhoopConnector>) : null))
      .then((data) => {
        if (data) setWhoop(data);
      })
      .catch(() => {
        // Connector status is non-critical — silent failure is fine.
      });
  }, []);

  useEffect(() => {
    refreshWhoop();
  }, [refreshWhoop]);

  useEffect(() => {
    const loaded: Record<string, boolean> = {};
    for (const s of LOCAL_SETTINGS) {
      loaded[s.key] = localStorage.getItem(s.key) === "1";
    }
    setLocalValues(loaded);

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

  async function handleConnectWhoop() {
    // Connect / Reconnect both go through the same Whoop OAuth start route.
    window.location.href = "/api/auth/login";
  }

  async function handleDisconnectWhoop() {
    if (whoopWorking) return;
    if (!confirm("Disconnect Whoop? You'll need to reconnect to resume syncing.")) return;
    setWhoopWorking(true);
    try {
      await fetch("/api/auth/whoop/disconnect", { method: "POST" });
      await refreshWhoop();
    } finally {
      setWhoopWorking(false);
    }
  }

  async function handleLogout() {
    if (!confirm("Sign out?")) return;
    window.location.href = "/api/auth/logout";
  }

  const promptDirty = systemPrompt !== savedSystemPrompt;
  const whoopStatus = whoop?.status ?? "disconnected";
  const whoopCopy = CONNECTOR_STATUS_COPY[whoopStatus];

  return (
    <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="card">
        <div className="card-head">
          <div className="card-title">Connectors</div>
        </div>
        <div style={{ paddingTop: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
              padding: "12px 14px",
              background: "rgba(0,0,0,0.2)",
              border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 8,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontFamily: "var(--font-sans)",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--fg-0)",
                }}
              >
                Whoop
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    fontWeight: 400,
                    color: whoopCopy.color,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      display: "inline-block",
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: whoopCopy.color,
                    }}
                  />
                  {whoopCopy.label}
                </span>
              </div>
              <div style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--fg-3)" }}>
                {whoop
                  ? whoop.last_sync_at
                    ? `Last sync ${formatRelative(whoop.last_sync_at)}`
                    : "No sync yet"
                  : "Loading…"}
                {whoop?.expires_at && whoopStatus !== "disconnected" && (
                  <>
                    {" · "}token{" "}
                    {formatRelative(whoop.expires_at)?.replace("ago", "old")}
                  </>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {whoopStatus !== "disconnected" ? (
                <>
                  <button
                    type="button"
                    onClick={handleConnectWhoop}
                    style={{
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      color: "var(--fg-0)",
                      padding: "6px 12px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontFamily: "var(--font-sans)",
                      cursor: "pointer",
                    }}
                  >
                    Reconnect
                  </button>
                  <button
                    type="button"
                    onClick={handleDisconnectWhoop}
                    disabled={whoopWorking}
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(255,80,80,0.3)",
                      color: "#ff8b8b",
                      padding: "6px 12px",
                      borderRadius: 6,
                      fontSize: 12,
                      fontFamily: "var(--font-sans)",
                      cursor: whoopWorking ? "wait" : "pointer",
                      opacity: whoopWorking ? 0.5 : 1,
                    }}
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleConnectWhoop}
                  style={{
                    background: "#7b61ff",
                    border: "none",
                    color: "#fff",
                    padding: "6px 14px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontFamily: "var(--font-sans)",
                    cursor: "pointer",
                  }}
                >
                  Connect
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

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
        <div className="card-head" style={{ alignItems: "center" }}>
          <div className="card-title">System prompt</div>
          <span className="card-sub">Edits apply to the next message</span>
        </div>
        <div style={{ paddingTop: 12 }}>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            spellCheck={false}
            style={{
              width: "100%",
              minHeight: 220,
              background: "rgba(0,0,0,0.25)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              padding: "12px 14px",
              color: "var(--fg-0)",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              lineHeight: 1.55,
              resize: "vertical",
              outline: "none",
            }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center", justifyContent: "flex-end" }}>
            <button
              onClick={resetSystemPrompt}
              disabled={systemPrompt === defaultSystemPrompt}
              style={{
                background: "none",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "var(--fg-2)",
                padding: "6px 14px",
                borderRadius: 6,
                fontSize: 12,
                cursor: systemPrompt === defaultSystemPrompt ? "default" : "pointer",
                opacity: systemPrompt === defaultSystemPrompt ? 0.4 : 1,
                fontFamily: "var(--font-sans)",
              }}
            >
              Reset to default
            </button>
            <button
              onClick={saveSystemPrompt}
              disabled={!promptDirty || saving}
              style={{
                background: promptDirty ? "#7b61ff" : "rgba(255,255,255,0.08)",
                border: "none",
                color: promptDirty ? "#fff" : "var(--fg-3)",
                padding: "6px 14px",
                borderRadius: 6,
                fontSize: 12,
                cursor: promptDirty && !saving ? "pointer" : "default",
                fontFamily: "var(--font-sans)",
              }}
            >
              {saving ? "Saving…" : promptDirty ? "Save changes" : "Saved"}
            </button>
          </div>
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

      <div className="card">
        <div className="card-head">
          <div className="card-title">Account</div>
        </div>
        <Row isFirst label="Sign out" description="Clear your session cookie and return to the sign-in page.">
          <button
            type="button"
            onClick={handleLogout}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,80,80,0.3)",
              color: "#ff8b8b",
              padding: "6px 14px",
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "var(--font-sans)",
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </Row>
      </div>
    </div>
  );
}
