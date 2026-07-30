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
type WhoopCheckStatus = "loading" | "ready" | "error";

type WhoopConnector = {
  provider: "whoop";
  status: WhoopConnectorStatus;
  expires_at: string | null;
  scope: string | null;
  source: "db" | null;
  last_sync_at: string | null;
};

type ByokState = { present: boolean; masked: string | null };
type CursorByokState = ByokState & { fallback_available: boolean };
type CursorModel = {
  id: string;
  display_name: string;
  description: string | null;
};
type CursorModelCatalogStatus =
  | "loading"
  | "ready"
  | "not_configured"
  | "invalid_key"
  | "unavailable";
type ByokError =
  | { kind: "invalid_key" }
  | { kind: "probe_failed" }
  | { kind: "request_failed"; message: string };

const ANTHROPIC_PREF = "anthropic:claude-sonnet-4-6";

const CONNECTOR_STATUS_COPY: Record<
  WhoopConnectorStatus,
  {
    label: string;
    tone: "statusGood" | "statusWarning" | "statusMuted";
  }
> = {
  connected: { label: "Connected", tone: "statusGood" },
  needs_reconnect: { label: "Needs reconnect", tone: "statusWarning" },
  disconnected: { label: "Disconnected", tone: "statusMuted" },
};

const CURSOR_MODEL_STATUS_COPY: Record<CursorModelCatalogStatus, string> = {
  ready: "Choose Claude directly or any model enabled for your Cursor account.",
  loading: "Loading the models enabled for your Cursor account…",
  invalid_key: "Cursor rejected the current key. Update it below to load models.",
  unavailable: "Cursor model discovery is temporarily unavailable.",
  not_configured: "Add a Cursor key below to enable its model catalog.",
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
  const [promptError, setPromptError] = useState<string | null>(null);
  const [whoop, setWhoop] = useState<WhoopConnector | null>(null);
  const [whoopCheckStatus, setWhoopCheckStatus] =
    useState<WhoopCheckStatus>("loading");
  const [whoopWorking, setWhoopWorking] = useState(false);
  const [byok, setByok] = useState<ByokState>({ present: false, masked: null });
  const [byokInput, setByokInput] = useState("");
  const [byokSaving, setByokSaving] = useState(false);
  const [byokClearing, setByokClearing] = useState(false);
  const [byokError, setByokError] = useState<ByokError | null>(null);
  const [cursorByok, setCursorByok] = useState<CursorByokState>({
    present: false,
    masked: null,
    fallback_available: false,
  });
  const [cursorByokInput, setCursorByokInput] = useState("");
  const [cursorByokSaving, setCursorByokSaving] = useState(false);
  const [cursorByokClearing, setCursorByokClearing] = useState(false);
  const [cursorByokError, setCursorByokError] = useState<ByokError | null>(
    null,
  );
  const [modelPref, setModelPref] = useState(ANTHROPIC_PREF);
  const [cursorAvailable, setCursorAvailable] = useState(false);
  const [cursorModels, setCursorModels] = useState<CursorModel[]>([]);
  const [cursorModelsStatus, setCursorModelsStatus] =
    useState<CursorModelCatalogStatus>("loading");
  const [modelSaving, setModelSaving] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  const refreshWhoop = useCallback(() => {
    // Keep connector status non-blocking: the rest of Settings still works
    // when this request is unavailable.
    fetch("/api/connectors/whoop")
      .then((response) =>
        response.ok ? (response.json() as Promise<WhoopConnector>) : null,
      )
      .then((data) => {
        if (!data) {
          setWhoop(null);
          setWhoopCheckStatus("error");
          return;
        }
        setWhoop(data);
        setWhoopCheckStatus("ready");
      })
      .catch(() => {
        setWhoop(null);
        setWhoopCheckStatus("error");
      });
  }, []);

  const refreshCursorModels = useCallback(async () => {
    setCursorModelsStatus("loading");
    try {
      const response = await fetch("/api/me/cursor-models");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as {
        status: Exclude<CursorModelCatalogStatus, "loading">;
        models: CursorModel[];
      };
      setCursorModels(data.models);
      setCursorModelsStatus(data.status);
    } catch {
      setCursorModels([]);
      setCursorModelsStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    refreshWhoop();
  }, [refreshWhoop]);

  useEffect(() => {
    const loaded: Record<string, boolean> = {};
    for (const setting of LOCAL_SETTINGS) {
      loaded[setting.key] = localStorage.getItem(setting.key) === "1";
    }
    // Defer browser-only preference hydration so this effect does not perform
    // a synchronous state update (react-hooks/set-state-in-effect).
    queueMicrotask(() => setLocalValues(loaded));

    fetch("/api/settings")
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{
              system_prompt: string;
              default_system_prompt: string;
              model_pref?: string;
              cursor_available?: boolean;
            }>)
          : null,
      )
      .then(
        (data) => {
          if (!data) return;
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

    fetch("/api/me/cursor-key")
      .then((response) =>
        response.ok ? (response.json() as Promise<CursorByokState>) : null,
      )
      .then((data) => {
        if (!data) return;
        setCursorByok(data);
        if (data.present || data.fallback_available) {
          setCursorAvailable(true);
        }
      })
      .catch(() => {});
    // Model discovery sets loading state immediately, so defer the initial
    // invocation for the same effect-lint reason as local preference hydration.
    queueMicrotask(() => void refreshCursorModels());
  }, [refreshCursorModels]);

  function toggleLocal(key: string, value: boolean) {
    localStorage.setItem(key, value ? "1" : "0");
    setLocalValues((previous) => ({ ...previous, [key]: value }));
  }

  const trimmedByokInput = byokInput.trim();
  const byokShapeValid =
    trimmedByokInput.startsWith("sk-ant-") && trimmedByokInput.length >= 20;
  const trimmedCursorByokInput = cursorByokInput.trim();
  const cursorByokShapeValid =
    trimmedCursorByokInput.length >= 16 &&
    !/\s/.test(trimmedCursorByokInput);

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
        setByok({ present: data.present, masked: data.masked });
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
    } catch (error) {
      setByokError({
        kind: "request_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setByokClearing(false);
    }
  }

  async function handleCursorByokSave() {
    if (cursorByokSaving || !cursorByokShapeValid) return;
    setCursorByokSaving(true);
    setCursorByokError(null);
    try {
      const response = await fetch("/api/me/cursor-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmedCursorByokInput }),
      });
      if (!response.ok) {
        setCursorByokError({
          kind: "request_failed",
          message: `HTTP ${response.status}`,
        });
        return;
      }
      const data = (await response.json()) as
        | ({ ok: true } & CursorByokState)
        | {
            ok: false;
            code: "invalid_key" | "invalid_request" | "probe_failed";
          };
      if (data.ok === true) {
        setCursorByok(data);
        setCursorByokInput("");
        setCursorAvailable(true);
        await refreshCursorModels();
        return;
      }
      if (data.code === "invalid_key") {
        setCursorByokError({ kind: "invalid_key" });
      } else if (data.code === "probe_failed") {
        setCursorByokError({ kind: "probe_failed" });
      } else {
        setCursorByokError({
          kind: "request_failed",
          message: data.code,
        });
      }
    } catch (error) {
      setCursorByokError({
        kind: "request_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCursorByokSaving(false);
    }
  }

  async function handleCursorByokClear() {
    if (cursorByokClearing) return;
    if (
      !confirm(
        "Remove your personal Cursor key? Coach will use the shared server key when available.",
      )
    ) {
      return;
    }
    setCursorByokClearing(true);
    setCursorByokError(null);
    try {
      const response = await fetch("/api/me/cursor-key", {
        method: "DELETE",
      });
      if (!response.ok) {
        setCursorByokError({
          kind: "request_failed",
          message: `HTTP ${response.status}`,
        });
        return;
      }
      const data = (await response.json()) as CursorByokState & {
        model_pref: string;
      };
      setCursorByok(data);
      setCursorByokInput("");
      setCursorAvailable(data.fallback_available);
      setModelPref(data.model_pref);
      if (data.fallback_available) {
        await refreshCursorModels();
      } else {
        setCursorModels([]);
        setCursorModelsStatus("not_configured");
      }
    } catch (error) {
      setCursorByokError({
        kind: "request_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setCursorByokClearing(false);
    }
  }

  function byokErrorMessage(
    provider: "Anthropic" | "Cursor",
    error: ByokError,
  ): string {
    switch (error.kind) {
      case "invalid_key":
        return `That key was rejected by ${provider}. Double-check and try again.`;
      case "probe_failed":
        return `Couldn't reach ${provider} to verify the key. Try again in a moment.`;
      case "request_failed":
        return `Request failed: ${error.message}`;
    }
  }

  async function saveModelPref(next: string) {
    if (next === modelPref) return;
    const previous = modelPref;
    setModelPref(next);
    setModelSaving(true);
    setModelError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_pref: next }),
      });
      if (!response.ok) {
        setModelPref(previous);
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setModelError(data?.error || `Couldn't save model (HTTP ${response.status}).`);
      } else {
        const data = (await response.json()) as { model_pref?: string };
        if (data.model_pref) setModelPref(data.model_pref);
      }
    } catch (error) {
      setModelPref(previous);
      setModelError(
        error instanceof Error ? error.message : "Couldn't save model.",
      );
    } finally {
      setModelSaving(false);
    }
  }

  async function saveSystemPrompt() {
    setSaving(true);
    setPromptError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system_prompt: systemPrompt }),
      });
      if (!response.ok) {
        throw new Error(`Couldn't save instructions (HTTP ${response.status}).`);
      }
      const data = (await response.json()) as { system_prompt: string };
      setSavedSystemPrompt(data.system_prompt);
    } catch (error) {
      setPromptError(
        error instanceof Error ? error.message : "Couldn't save instructions.",
      );
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
      const response = await fetch("/api/auth/whoop/disconnect", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      refreshWhoop();
    } catch {
      setWhoopCheckStatus("error");
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
  const selectedCursorModel = modelPref.startsWith("cursor:")
    ? modelPref.slice("cursor:".length)
    : null;
  const selectedCursorModelIsMissing =
    selectedCursorModel !== null &&
    !cursorModels.some((model) => model.id === selectedCursorModel);
  const modelDescription =
    modelError ?? CURSOR_MODEL_STATUS_COPY[cursorModelsStatus];

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
                      {whoopCheckStatus === "loading"
                        ? "Checking"
                        : whoopCheckStatus === "error"
                          ? "Unavailable"
                          : whoopCopy.label}
                    </span>
                  </div>
                  <p className={styles.connectorMeta}>
                    {whoopCheckStatus === "error"
                      ? "Couldn't load connection status. Try again."
                      : whoop
                      ? whoop.last_sync_at
                        ? `Last sync ${formatRelative(whoop.last_sync_at)}`
                        : "Ready for the first sync"
                      : "Checking connection status…"}
                  </p>
                </div>
              </div>

              <div className={styles.actionGroup}>
                {whoopCheckStatus === "error" ? (
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => {
                      setWhoopCheckStatus("loading");
                      refreshWhoop();
                    }}
                  >
                    Retry
                  </button>
                ) : whoopStatus !== "disconnected" ? (
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
              description={modelDescription}
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
                {cursorModels.map((model) => (
                  <option key={model.id} value={`cursor:${model.id}`}>
                    Cursor — {model.display_name}
                  </option>
                ))}
                {cursorAvailable && selectedCursorModelIsMissing && (
                  <option value={`cursor:${selectedCursorModel}`}>
                    Cursor — {selectedCursorModel} (saved)
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
                  {byokErrorMessage("Anthropic", byokError)}
                </p>
              )}
              <p className={styles.privacyNote}>
                Your key is encrypted at rest and never shown again after it is
                saved.
              </p>
            </div>

            <div className={styles.divider} />

            <div className={styles.stackedSetting} id="coach-cursor-byok">
              <div className={styles.stackedHeader}>
                <div className={styles.settingCopy}>
                  <div className={styles.labelWithIcon}>
                    <KeyRound aria-hidden size={15} />
                    <h3>Cursor access</h3>
                  </div>
                  <p>
                    {cursorByok.present
                      ? "Composer is using your encrypted personal API key."
                      : cursorByok.fallback_available
                        ? "Composer is currently using the shared server key."
                        : "Add a personal key to enable Cursor Composer."}
                  </p>
                </div>
                <span
                  className={`${styles.sourceBadge} ${
                    cursorByok.present ? styles.sourcePersonal : ""
                  }`}
                >
                  {cursorByok.present
                    ? "Personal key"
                    : cursorByok.fallback_available
                      ? "Shared key"
                      : "Not configured"}
                </span>
              </div>

              {cursorByok.present ? (
                <div className={styles.inlineControl}>
                  <code className={styles.maskedKey}>{cursorByok.masked}</code>
                  <button
                    type="button"
                    className={styles.dangerButton}
                    onClick={handleCursorByokClear}
                    disabled={cursorByokClearing}
                    data-track="settings:cursor-byok-clear"
                  >
                    {cursorByokClearing ? "Removing…" : "Remove key"}
                  </button>
                </div>
              ) : (
                <div className={styles.inlineControl}>
                  <input
                    className={styles.textInput}
                    type="password"
                    value={cursorByokInput}
                    onChange={(event) => {
                      setCursorByokInput(event.target.value);
                      if (cursorByokError) setCursorByokError(null);
                    }}
                    placeholder="Paste Cursor API key"
                    aria-label="Personal Cursor API key"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className={styles.primaryButton}
                    onClick={handleCursorByokSave}
                    disabled={!cursorByokShapeValid || cursorByokSaving}
                    data-track="settings:cursor-byok-save"
                  >
                    {cursorByokSaving ? "Verifying…" : "Use this key"}
                  </button>
                </div>
              )}

              {cursorByokError && (
                <p className={styles.errorMessage} role="alert">
                  {byokErrorMessage("Cursor", cursorByokError)}
                </p>
              )}
              <p className={styles.privacyNote}>
                Your key is verified without a model turn, then encrypted at
                rest.
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
                  {saving
                    ? "Saving…"
                    : promptError
                      ? "Save failed"
                      : promptDirty
                        ? "Unsaved changes"
                        : "Saved"}
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
              {promptError && (
                <p className={styles.errorMessage} role="alert">
                  {promptError}
                </p>
              )}
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
