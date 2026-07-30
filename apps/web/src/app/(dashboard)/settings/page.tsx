"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BrainCircuit,
  KeyRound,
  LogOut,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import styles from "./settings.module.css";

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
  source: "db" | null;
  last_sync_at: string | null;
};

type ByokState = { present: boolean; masked: string | null };
type ByokError =
  | { kind: "invalid_key" }
  | { kind: "probe_failed" }
  | { kind: "request_failed"; message: string };

const CONNECTOR_STATUS_COPY: Record<
  WhoopConnectorStatus,
  { label: string; tone: string }
> = {
  connected: { label: "Connected", tone: "statusGood" },
  needs_reconnect: { label: "Needs reconnect", tone: "statusWarning" },
  disconnected: { label: "Disconnected", tone: "statusMuted" },
};

const LOCAL_SETTINGS: LocalSetting[] = [
  {
    key: "trendline",
    label: "Line of best fit",
    description:
      "Overlay a linear trend line on charts to make direction easier to spot.",
  },
];

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

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={styles.toggle}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      data-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
    >
      <span className={styles.toggleThumb} />
    </button>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.settingRow}>
      <div className={styles.settingCopy}>
        <h3>{label}</h3>
        <p>{description}</p>
      </div>
      {children}
    </div>
  );
}

export default function SettingsPage() {
  const [localValues, setLocalValues] = useState<Record<string, boolean>>({});
  const [systemPrompt, setSystemPrompt] = useState("");
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState("");
  const [savedSystemPrompt, setSavedSystemPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const [whoop, setWhoop] = useState<WhoopConnector | null>(null);
  const [whoopWorking, setWhoopWorking] = useState(false);
  const [byok, setByok] = useState<ByokState>({ present: false, masked: null });
  const [byokInput, setByokInput] = useState("");
  const [byokSaving, setByokSaving] = useState(false);
  const [byokClearing, setByokClearing] = useState(false);
  const [byokError, setByokError] = useState<ByokError | null>(null);
  const [modelPref, setModelPref] = useState(
    "anthropic:claude-sonnet-4-6",
  );
  const [cursorAvailable, setCursorAvailable] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);

  const refreshWhoop = useCallback(() => {
    // Keep connector status non-blocking: the rest of Settings still works
    // when this request is unavailable.
    fetch("/api/connectors/whoop")
      .then((response) =>
        response.ok ? (response.json() as Promise<WhoopConnector>) : null,
      )
      .then((data) => {
        if (data) setWhoop(data);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshWhoop();
  }, [refreshWhoop]);

  useEffect(() => {
    const loaded: Record<string, boolean> = {};
    for (const setting of LOCAL_SETTINGS) {
      loaded[setting.key] = localStorage.getItem(setting.key) === "1";
    }
    queueMicrotask(() => setLocalValues(loaded));

    fetch("/api/settings")
      .then((response) => response.json())
      .then(
        (data: {
          system_prompt: string;
          default_system_prompt: string;
          model_pref?: string;
          cursor_available?: boolean;
        }) => {
          setSystemPrompt(data.system_prompt);
          setSavedSystemPrompt(data.system_prompt);
          setDefaultSystemPrompt(data.default_system_prompt);
          if (data.model_pref) setModelPref(data.model_pref);
          setCursorAvailable(Boolean(data.cursor_available));
        },
      )
      .catch(() => {});

    fetch("/api/me/anthropic-key")
      .then((response) =>
        response.ok ? (response.json() as Promise<ByokState>) : null,
      )
      .then((data) => {
        if (data) setByok(data);
      })
      .catch(() => {});
  }, []);

  function toggleLocal(key: string, value: boolean) {
    localStorage.setItem(key, value ? "1" : "0");
    setLocalValues((previous) => ({ ...previous, [key]: value }));
  }

  const trimmedByokInput = byokInput.trim();
  const byokShapeValid =
    trimmedByokInput.startsWith("sk-ant-") && trimmedByokInput.length >= 20;

  async function handleByokSave() {
    if (byokSaving || !byokShapeValid) return;
    setByokSaving(true);
    setByokError(null);
    try {
      const response = await fetch("/api/me/anthropic-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmedByokInput }),
      });
      if (!response.ok) {
        setByokError({
          kind: "request_failed",
          message: `HTTP ${response.status}`,
        });
        return;
      }
      const data = (await response.json()) as
        | { ok: true; present: true; masked: string }
        | {
            ok: false;
            code: "invalid_key" | "invalid_request" | "probe_failed";
          };
      if (data.ok === true) {
        const freshResponse = await fetch("/api/me/anthropic-key");
        if (freshResponse.ok) {
          setByok((await freshResponse.json()) as ByokState);
        } else {
          setByok({ present: data.present, masked: data.masked });
        }
        setByokInput("");
        return;
      }
      if (data.code === "invalid_key") {
        setByokError({ kind: "invalid_key" });
      } else if (data.code === "probe_failed") {
        setByokError({ kind: "probe_failed" });
      } else {
        setByokError({ kind: "request_failed", message: data.code });
      }
    } catch (error) {
      setByokError({
        kind: "request_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setByokSaving(false);
    }
  }

  async function handleByokClear() {
    if (byokClearing) return;
    if (
      !confirm(
        "Remove your personal Anthropic key? The Coach will fall back to the shared server key.",
      )
    ) {
      return;
    }
    setByokClearing(true);
    setByokError(null);
    try {
      const response = await fetch("/api/me/anthropic-key", {
        method: "DELETE",
      });
      if (!response.ok) {
        setByokError({
          kind: "request_failed",
          message: `HTTP ${response.status}`,
        });
        return;
      }
      setByok({ present: false, masked: null });
      setByokInput("");
    } finally {
      setByokClearing(false);
    }
  }

  function byokErrorMessage(error: ByokError): string {
    switch (error.kind) {
      case "invalid_key":
        return "That key was rejected by Anthropic. Double-check and try again.";
      case "probe_failed":
        return "Couldn't reach Anthropic to verify the key. Try again in a moment.";
      case "request_failed":
        return `Request failed: ${error.message}`;
    }
  }

  async function saveModelPref(next: string) {
    if (next === modelPref) return;
    const previous = modelPref;
    setModelPref(next);
    setModelSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_pref: next }),
      });
      if (!response.ok) {
        setModelPref(previous);
      } else {
        const data = (await response.json()) as { model_pref?: string };
        if (data.model_pref) setModelPref(data.model_pref);
      }
    } catch {
      setModelPref(previous);
    } finally {
      setModelSaving(false);
    }
  }

  async function saveSystemPrompt() {
    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system_prompt: systemPrompt }),
      });
      const data = (await response.json()) as { system_prompt: string };
      setSavedSystemPrompt(data.system_prompt);
    } finally {
      setSaving(false);
    }
  }

  function handleConnectWhoop() {
    window.location.href = "/api/auth/login";
  }

  async function handleDisconnectWhoop() {
    if (whoopWorking) return;
    if (
      !confirm(
        "Disconnect Whoop? You'll need to reconnect to resume syncing.",
      )
    ) {
      return;
    }
    setWhoopWorking(true);
    try {
      await fetch("/api/auth/whoop/disconnect", { method: "POST" });
      refreshWhoop();
    } finally {
      setWhoopWorking(false);
    }
  }

  function handleLogoutSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!confirm("Sign out?")) {
      event.preventDefault();
    }
  }

  const promptDirty = systemPrompt !== savedSystemPrompt;
  const whoopStatus = whoop?.status ?? "disconnected";
  const whoopCopy = CONNECTOR_STATUS_COPY[whoopStatus];

  return (
    <div className={styles.settingsPage}>
      <header className={styles.pageIntro}>
        <p className={styles.eyebrow}>Your workspace</p>
        <h2>One place to shape how Coach works for you.</h2>
        <p className={styles.introCopy}>
          Manage your data source, Coach behavior, and personal preferences
          without digging through separate setup screens.
        </p>
      </header>

      <div className={styles.settingsSurface}>
        <section className={styles.settingsSection}>
          <div className={styles.sectionIntro}>
            <span className={styles.sectionIcon}>
              <Activity aria-hidden size={18} />
            </span>
            <div>
              <h2>Connections</h2>
              <p>Control the health data that flows into your dashboard.</p>
            </div>
          </div>

          <div className={styles.sectionBody}>
            <div className={styles.connectorRow}>
              <div className={styles.connectorIdentity}>
                <span className={styles.whoopMark} aria-hidden>
                  W
                </span>
                <div>
                  <div className={styles.connectorTitle}>
                    <h3>Whoop</h3>
                    <span
                      className={`${styles.status} ${styles[whoopCopy.tone]}`}
                    >
                      <span className={styles.statusDot} aria-hidden />
                      {whoop ? whoopCopy.label : "Checking"}
                    </span>
                  </div>
                  <p className={styles.connectorMeta}>
                    {whoop
                      ? whoop.last_sync_at
                        ? `Last sync ${formatRelative(whoop.last_sync_at)}`
                        : "Ready for the first sync"
                      : "Checking connection status…"}
                  </p>
                </div>
              </div>

              <div className={styles.actionGroup}>
                {whoopStatus !== "disconnected" ? (
                  <>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={handleConnectWhoop}
                      data-track="whoop:reconnect"
                    >
                      Reconnect
                    </button>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={handleDisconnectWhoop}
                      disabled={whoopWorking}
                      data-track="whoop:disconnect"
                    >
                      {whoopWorking ? "Disconnecting…" : "Disconnect"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={handleConnectWhoop}
                    data-track="whoop:connect"
                  >
                    Connect Whoop
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className={styles.settingsSection}>
          <div className={styles.sectionIntro}>
            <span className={`${styles.sectionIcon} ${styles.coachIcon}`}>
              <BrainCircuit aria-hidden size={18} />
            </span>
            <div>
              <h2>Coach</h2>
              <p>Choose the intelligence, access, and voice behind each reply.</p>
            </div>
          </div>

          <div className={styles.sectionBody}>
            <SettingRow
              label="Model"
              description={
                cursorAvailable
                  ? "Claude is the default. Cursor Composer is experimental."
                  : "Claude Sonnet is the active model on this server."
              }
            >
              <select
                className={styles.select}
                value={modelPref}
                disabled={modelSaving}
                aria-label="Coach model"
                onChange={(event) => saveModelPref(event.target.value)}
              >
                <option value="anthropic:claude-sonnet-4-6">
                  Claude Sonnet 4.6
                </option>
                {cursorAvailable && (
                  <option value="cursor:composer-2.5">
                    Cursor Composer 2.5 · experimental
                  </option>
                )}
              </select>
            </SettingRow>

            <div className={styles.divider} />

            <div className={styles.stackedSetting} id="coach-byok">
              <div className={styles.stackedHeader}>
                <div className={styles.settingCopy}>
                  <div className={styles.labelWithIcon}>
                    <KeyRound aria-hidden size={15} />
                    <h3>Anthropic access</h3>
                  </div>
                  <p>
                    {byok.present
                      ? "Coach is using your encrypted personal API key."
                      : "Coach is currently using the shared server key."}
                  </p>
                </div>
                <span
                  className={`${styles.sourceBadge} ${
                    byok.present ? styles.sourcePersonal : ""
                  }`}
                >
                  {byok.present ? "Personal key" : "Shared key"}
                </span>
              </div>

              {byok.present ? (
                <div className={styles.inlineControl}>
                  <code className={styles.maskedKey}>{byok.masked}</code>
                  <button
                    type="button"
                    className={styles.dangerButton}
                    onClick={handleByokClear}
                    disabled={byokClearing}
                    data-track="settings:byok-clear"
                  >
                    {byokClearing ? "Removing…" : "Remove key"}
                  </button>
                </div>
              ) : (
                <div className={styles.inlineControl}>
                  <input
                    className={styles.textInput}
                    type="password"
                    value={byokInput}
                    onChange={(event) => {
                      setByokInput(event.target.value);
                      if (byokError) setByokError(null);
                    }}
                    placeholder="Paste sk-ant-…"
                    aria-label="Personal Anthropic API key"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={handleByokSave}
                    disabled={!byokShapeValid || byokSaving}
                    data-track="settings:byok-save"
                  >
                    {byokSaving ? "Verifying…" : "Use this key"}
                  </button>
                </div>
              )}

              {byokError && (
                <p className={styles.errorMessage} role="alert">
                  {byokErrorMessage(byokError)}
                </p>
              )}
              <p className={styles.privacyNote}>
                Your key is encrypted at rest and never shown again after it is
                saved.
              </p>
            </div>

            <div className={styles.divider} />

            <div className={styles.stackedSetting}>
              <div className={styles.stackedHeader}>
                <div className={styles.settingCopy}>
                  <h3>Instructions</h3>
                  <p>
                    Give Coach persistent context about how you want it to
                    think and respond.
                  </p>
                </div>
                <span className={styles.saveState} aria-live="polite">
                  {saving ? "Saving…" : promptDirty ? "Unsaved changes" : "Saved"}
                </span>
              </div>
              <textarea
                className={styles.promptInput}
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                aria-label="Coach instructions"
                spellCheck={false}
              />
              <div className={styles.promptActions}>
                <span>Changes apply to your next message.</span>
                <div className={styles.actionGroup}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => setSystemPrompt(defaultSystemPrompt)}
                    disabled={systemPrompt === defaultSystemPrompt}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={saveSystemPrompt}
                    disabled={!promptDirty || saving}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.settingsSection}>
          <div className={styles.sectionIntro}>
            <span className={styles.sectionIcon}>
              <SlidersHorizontal aria-hidden size={18} />
            </span>
            <div>
              <h2>Preferences</h2>
              <p>Tune how the dashboard presents your data on this device.</p>
            </div>
          </div>

          <div className={styles.sectionBody}>
            {LOCAL_SETTINGS.map((setting) => (
              <SettingRow
                key={setting.key}
                label={setting.label}
                description={setting.description}
              >
                <Toggle
                  label={`Toggle ${setting.label.toLowerCase()}`}
                  checked={Boolean(localValues[setting.key])}
                  onChange={(value) => toggleLocal(setting.key, value)}
                />
              </SettingRow>
            ))}
          </div>
        </section>

        <section className={styles.settingsSection}>
          <div className={styles.sectionIntro}>
            <span className={styles.sectionIcon}>
              <UserRound aria-hidden size={18} />
            </span>
            <div>
              <h2>Account</h2>
              <p>Manage access to this dashboard.</p>
            </div>
          </div>

          <div className={styles.sectionBody}>
            <SettingRow
              label="Sign out"
              description="Clear your session on this device and return to sign in."
            >
              <form
                method="post"
                action="/api/auth/logout"
                onSubmit={handleLogoutSubmit}
                className={styles.signoutForm}
              >
                <button
                  type="submit"
                  className={styles.dangerButton}
                  data-track="auth:signout"
                >
                  <LogOut aria-hidden size={14} />
                  Sign out
                </button>
              </form>
            </SettingRow>
          </div>
        </section>
      </div>
    </div>
  );
}
