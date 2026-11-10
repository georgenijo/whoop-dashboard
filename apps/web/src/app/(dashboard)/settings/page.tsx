"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  LogOut,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import styles from "./settings.module.css";
import type { AnthropicModelOption } from "@/lib/coach/anthropic-model-options";

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
  last_event_at: string | null;
};

type ByokState = { present: boolean; masked: string | null };
type AnthropicByokState = ByokState & {
  fallback_available: boolean;
  source: "user" | "env" | "none";
};
type ByokCheckStatus = "loading" | "ready" | "unavailable";
type CursorByokState = ByokState & { fallback_available: boolean };
type CursorModel = {
  id: string;
  display_name: string;
  description: string | null;
};
type ModelCatalogStatus =
  | "loading"
  | "ready"
  | "not_configured"
  | "invalid_key"
  | "unavailable";
type ByokError =
  | { kind: "invalid_key" }
  | { kind: "probe_failed" }
  | { kind: "request_failed"; message: string };

// Issue #587 — the Coach-model selection (a saved preference or the
// COACH_DEFAULT_MODEL override, both resolved server-side) is only known to
// GET /api/settings. COACH_DEFAULT_MODEL is server-only, so it can never be
// part of an initial client render: until that response lands, the picker
// renders an identical disabled placeholder on server and client — showing no
// model, and not interactively saveable — then adopts the effective selection.

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

const CURSOR_MODEL_STATUS_COPY: Record<ModelCatalogStatus, string> = {
  ready: "Choose any model enabled for your Cursor account.",
  loading: "Loading the models enabled for your Cursor account…",
  invalid_key: "Cursor rejected the current key. Update it below to load models.",
  unavailable: "Cursor model discovery is temporarily unavailable.",
  not_configured: "Add a Cursor key below to enable its model catalog.",
};

const ANTHROPIC_MODEL_STATUS_COPY: Record<ModelCatalogStatus, string> = {
  ready: "Choose any model available to your Anthropic account.",
  loading: "Loading the models available to your Anthropic account…",
  invalid_key: "Anthropic rejected the current key. Update it below to load models.",
  unavailable: "Anthropic model discovery is temporarily unavailable.",
  not_configured: "Add an Anthropic key below to enable its model catalog.",
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
  const [savedSystemPrompt, setSavedSystemPrompt] = useState("");
  // Mirrors savedSystemPrompt so loadSettings (a stable callback) can tell
  // whether the draft was edited since the last baseline without a stale closure.
  const savedSystemPromptRef = useRef("");
  const [saving, setSaving] = useState(false);
  const [backgroundFailure, setBackgroundFailure] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [whoop, setWhoop] = useState<WhoopConnector | null>(null);
  const [whoopCheckStatus, setWhoopCheckStatus] =
    useState<WhoopCheckStatus>("loading");
  const [whoopWorking, setWhoopWorking] = useState(false);
  const [byok, setByok] = useState<AnthropicByokState>({
    present: false,
    masked: null,
    fallback_available: false,
    source: "none",
  });
  const [byokStatus, setByokStatus] = useState<ByokCheckStatus>("loading");
  const [collapsedProviders, setCollapsedProviders] = useState({
    Anthropic: false,
    Cursor: false,
  });
  const [byokInput, setByokInput] = useState("");
  const [byokSaving, setByokSaving] = useState(false);
  const [byokClearing, setByokClearing] = useState(false);
  const [byokError, setByokError] = useState<ByokError | null>(null);
  const [cursorByok, setCursorByok] = useState<CursorByokState>({
    present: false,
    masked: null,
    fallback_available: false,
  });
  const [cursorByokStatus, setCursorByokStatus] = useState<ByokCheckStatus>("loading");
  const [cursorByokInput, setCursorByokInput] = useState("");
  const [cursorByokSaving, setCursorByokSaving] = useState(false);
  const [cursorByokClearing, setCursorByokClearing] = useState(false);
  const [cursorByokError, setCursorByokError] = useState<ByokError | null>(
    null,
  );
  const [modelPref, setModelPref] = useState("");
  // False until the effective selection (saved preference or the server-side
  // COACH_DEFAULT_MODEL default) arrives from GET /api/settings. While false
  // the picker stays disabled and shows no model, so an interim — possibly
  // overridden — selection can neither display wrong nor be saved.
  const [modelPrefLoaded, setModelPrefLoaded] = useState(false);
  // A failed settings load is explicit and retryable rather than an eternal
  // "Loading your saved model…" with no explanation or recovery path.
  const [modelPrefLoadFailed, setModelPrefLoadFailed] = useState(false);
  const [modelPrefReloading, setModelPrefReloading] = useState(false);
  const [anthropicModels, setAnthropicModels] = useState<AnthropicModelOption[]>([]);
  const [anthropicModelsStatus, setAnthropicModelsStatus] =
    useState<ModelCatalogStatus>("loading");
  const [cursorModels, setCursorModels] = useState<CursorModel[]>([]);
  const [cursorModelsStatus, setCursorModelsStatus] =
    useState<ModelCatalogStatus>("loading");
  const anthropicCatalogRequestRef = useRef(0);
  const cursorCatalogRequestRef = useRef(0);
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
    const request = ++cursorCatalogRequestRef.current;
    setCursorModelsStatus("loading");
    try {
      const response = await fetch("/api/me/cursor-models");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as {
        status: Exclude<ModelCatalogStatus, "loading">;
        models: CursorModel[];
      };
      if (request !== cursorCatalogRequestRef.current) return;
      setCursorModels(data.models);
      setCursorModelsStatus(data.status);
    } catch {
      if (request !== cursorCatalogRequestRef.current) return;
      setCursorModels([]);
      setCursorModelsStatus("unavailable");
    }
  }, []);

  const refreshAnthropicModels = useCallback(async () => {
    const request = ++anthropicCatalogRequestRef.current;
    setAnthropicModelsStatus("loading");
    try {
      const response = await fetch("/api/me/anthropic-models");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as {
        status: Exclude<ModelCatalogStatus, "loading">;
        models: AnthropicModelOption[];
      };
      if (request !== anthropicCatalogRequestRef.current) return;
      setAnthropicModels(data.models);
      setAnthropicModelsStatus(data.status);
    } catch {
      if (request !== anthropicCatalogRequestRef.current) return;
      setAnthropicModels([]);
      setAnthropicModelsStatus("unavailable");
    }
  }, []);

  // Load the effective Coach-model selection (saved preference or the
  // server-resolved COACH_DEFAULT_MODEL default) plus the raw instructions.
  // Failure is explicit and retryable (Retry control): the picker stays
  // fail-closed — disabled, selection unknown — while the payload is
  // unavailable, instead of loading forever or saving an unknown selection.
  const loadSettings = useCallback(async (): Promise<void> => {
    setModelPrefReloading(true);
    try {
      const response = await fetch("/api/settings");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as {
        system_prompt: string;
        model_pref?: string;
        cursor_available?: boolean;
      };
      if (data === null || typeof data !== "object" || typeof data.model_pref !== "string") {
        throw new Error("malformed settings payload");
      }
      // Never clobber an edited draft (e.g. typed while the first load had
      // failed, then Retry): adopt the server text only when the draft still
      // equals the previous baseline. The baseline itself always refreshes, so
      // a kept draft correctly stays "Unsaved changes" against the new one.
      const previousBaseline = savedSystemPromptRef.current;
      setSystemPrompt((draft) =>
        draft === previousBaseline ? data.system_prompt : draft,
      );
      savedSystemPromptRef.current = data.system_prompt;
      setSavedSystemPrompt(data.system_prompt);
      setModelPref(data.model_pref);
      setModelPrefLoaded(true);
      setModelPrefLoadFailed(false);
    } catch {
      setModelPrefLoadFailed(true);
    } finally {
      setModelPrefReloading(false);
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

    fetch("/api/insights/status", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((status) => {
        const reasons = [status?.errorClass, status?.titleErrorClass];
        const reason = reasons.includes("bad_key") ? "bad_key" : reasons.includes("provider_error") ? "provider_error" : reasons.includes("no_key") ? "no_key" : null;
        if (reason === "bad_key") setBackgroundFailure("Anthropic rejected the current key. Update it below to restore insights and conversation titles.");
        else if (reason === "provider_error") setBackgroundFailure("Anthropic could not generate an insight or conversation title. Check your account credits and try again later.");
        else if (reason === "no_key") setBackgroundFailure("Add an Anthropic key below to enable insights and conversation titles.");
      })
      .catch(() => {});

    // Retryable; keeps the model picker fail-closed until this lands.
    queueMicrotask(() => { void loadSettings(); });

    fetch("/api/me/anthropic-key")
      .then((response) =>
        response.ok ? (response.json() as Promise<AnthropicByokState>) : null,
      )
      .then((data) => {
        if (!data) {
          setByokStatus("unavailable");
          return;
        }
        setByok(data);
        setByokStatus("ready");
      })
      .catch(() => setByokStatus("unavailable"));

    fetch("/api/me/cursor-key")
      .then((response) =>
        response.ok ? (response.json() as Promise<CursorByokState>) : null,
      )
      .then((data) => {
        if (!data) {
          setCursorByokStatus("unavailable");
          return;
        }
        setCursorByok(data);
        setCursorByokStatus("ready");
      })
      .catch(() => setCursorByokStatus("unavailable"));
    // Model discovery sets loading state immediately, so defer the initial
    // invocation for the same effect-lint reason as local preference hydration.
    queueMicrotask(() => {
      void refreshCursorModels();
      void refreshAnthropicModels();
    });
  }, [refreshCursorModels, refreshAnthropicModels, loadSettings]);

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
        | ({ ok: true } & AnthropicByokState)
        | {
            ok: false;
            code: "invalid_key" | "invalid_request" | "probe_failed";
      };
      if (data.ok === true) {
        setByok(data);
        setBackgroundFailure(null);
        setByokStatus("ready");
        setByokInput("");
        await refreshAnthropicModels();
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
        byok.fallback_available
          ? "Remove your personal Anthropic key? Coach will use the shared server key."
          : "Remove your personal Anthropic key? Anthropic models will be unavailable until you add a key.",
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
      const data = await response.json() as AnthropicByokState;
      setByok(data);
      setBackgroundFailure(null);
      setByokStatus("ready");
      setByokInput("");
      await refreshAnthropicModels();
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
        setCursorByokStatus("ready");
        setCursorByokInput("");
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
        model_pref?: string;
      };
      setCursorByok(data);
      setCursorByokStatus("ready");
      setCursorByokInput("");
      if (data.model_pref) setModelPref(data.model_pref);
      // The Cursor-key route resolves the effective selection server-side
      // (parseModelPref), so it counts as a loaded selection even if the
      // settings request had not landed yet.
      setModelPrefLoaded(true);
      if (data.fallback_available) {
        await refreshCursorModels();
      } else {
        cursorCatalogRequestRef.current += 1;
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
    if (next === modelPref || modelSaving) return;
    if (!modelGroups.some((group) =>
      group.status === "ready" &&
      group.models.some((model) => `${group.prefix}:${model.id}` === next),
    )) return;
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
        setModelPrefLoaded(true);
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
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(
          data?.error || `Couldn't save instructions (HTTP ${response.status}).`,
        );
      }
      const data = (await response.json()) as { system_prompt: string };
      setSystemPrompt(data.system_prompt);
      savedSystemPromptRef.current = data.system_prompt;
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
  const modelGroups = [
    {
      provider: "Anthropic",
      prefix: "anthropic",
      status: anthropicModelsStatus,
      models: anthropicModels,
    },
    {
      provider: "Cursor",
      prefix: "cursor",
      status: cursorModelsStatus,
      models: cursorModels,
    },
  ];
  const selectedModelMissing = !modelGroups.some((group) =>
    group.models.some((model) => `${group.prefix}:${model.id}` === modelPref),
  );
  const modelDescription = modelError ??
    "Choose a model from a connected provider. Availability is checked with each provider.";
  const anthropicSourceLabel = byokStatus === "loading" ? "Checking access"
    : byokStatus === "unavailable" ? "Access unknown"
    : byok.source === "user" ? "Personal key"
    : byok.source === "env" ? "Shared key" : "Not configured";

  const cursorSourceLabel = cursorByokStatus === "loading" ? "Checking access"
    : cursorByokStatus === "unavailable" ? "Access unknown"
    : cursorByok.present ? "Personal key"
    : cursorByok.fallback_available ? "Shared key" : "Not configured";

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
                        ? `Last full sync ${formatRelative(whoop.last_sync_at)}`
                        : "No full sync recorded"
                      : "Checking connection status…"}
                  </p>
                  {whoop?.last_event_at && (
                    <p className={styles.connectorMeta}>
                      Latest Whoop update {formatRelative(whoop.last_event_at)} · individual metrics may differ
                    </p>
                  )}
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
                value={modelPrefLoaded ? modelPref : ""}
                disabled={modelSaving || !modelPrefLoaded}
                aria-label="Coach model"
                onChange={(event) => saveModelPref(event.target.value)}
              >
                {!modelPrefLoaded ? (
                  <option value="" disabled>
                    {modelPrefLoadFailed ? "Unavailable" : "Loading your saved model…"}
                  </option>
                ) : null}
                {modelGroups.map((group) => (
                  <optgroup
                    key={group.prefix}
                    label={group.provider}
                    disabled={group.status !== "ready"}
                  >
                    {group.models.map((model) => (
                      <option
                        key={model.id}
                        value={`${group.prefix}:${model.id}`}
                        disabled={group.status !== "ready"}
                      >
                        {model.display_name}
                      </option>
                    ))}
                    {group.models.length === 0 ? (
                      <option disabled value={`${group.prefix}:unavailable`}>
                        {group.status === "loading" ? "Loading models…" : "No models available"}
                      </option>
                    ) : null}
                  </optgroup>
                ))}
                {modelPrefLoaded && selectedModelMissing ? (
                  <option value={modelPref} disabled>
                    {modelPref.replace(/^(anthropic|cursor):/, "")} (saved, unavailable)
                  </option>
                ) : null}
              </select>
            </SettingRow>
            {modelPrefLoadFailed ? (
              <div className={styles.inlineControl} data-testid="model-load-error">
                <p className={styles.catalogStatus} role="alert">
                  Couldn&apos;t load your saved model.
                </p>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={modelPrefReloading}
                  onClick={() => { void loadSettings(); }}
                >
                  Retry
                </button>
              </div>
            ) : null}

            <div className={styles.divider} />

            {backgroundFailure ? <p role="alert">{backgroundFailure}</p> : null}
            <div className={styles.stackedSetting} id="coach-byok">
              <button
                type="button"
                className={styles.providerDisclosure}
                aria-label={`Anthropic access; ${anthropicSourceLabel}`}
                aria-expanded={!collapsedProviders.Anthropic}
                aria-controls="anthropic-access-settings"
                onClick={() => setCollapsedProviders((previous) => ({ ...previous, Anthropic: !previous.Anthropic }))}
              >
                {collapsedProviders.Anthropic ? <ChevronRight size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
                <span>Anthropic access</span>
                <span className={styles.sourceBadge}>{anthropicSourceLabel}</span>
              </button>
              <div id="anthropic-access-settings" hidden={collapsedProviders.Anthropic}>
                <div className={styles.providerContent}>
                  <p className={styles.catalogStatus} role="status">{ANTHROPIC_MODEL_STATUS_COPY[anthropicModelsStatus]}</p>
                  <div className={styles.stackedHeader}>
                    <div className={styles.settingCopy}>
                      <p>
                        {byokStatus === "loading" ? "Checking Anthropic access…"
                          : byokStatus === "unavailable" ? "Couldn't check Anthropic key source. Reload Settings to try again."
                          : byok.source === "user" ? "Anthropic requests use your encrypted personal API key."
                          : byok.source === "env" ? "Anthropic requests use the shared server key."
                          : "Add a personal API key to enable Anthropic models."}
                      </p>
                    </div>
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
              </div>
            </div>

            <div className={styles.divider} />

            <div className={styles.stackedSetting} id="coach-cursor-byok">
              <button
                type="button"
                className={styles.providerDisclosure}
                aria-label={`Cursor access; ${cursorSourceLabel}`}
                aria-expanded={!collapsedProviders.Cursor}
                aria-controls="cursor-access-settings"
                onClick={() => setCollapsedProviders((previous) => ({ ...previous, Cursor: !previous.Cursor }))}
              >
                {collapsedProviders.Cursor ? <ChevronRight size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
                <span>Cursor access</span>
                <span className={styles.sourceBadge}>{cursorSourceLabel}</span>
              </button>
              <div id="cursor-access-settings" hidden={collapsedProviders.Cursor}>
                <div className={styles.providerContent}>
                  <p className={styles.catalogStatus} role="status">{CURSOR_MODEL_STATUS_COPY[cursorModelsStatus]}</p>
                  <div className={styles.stackedHeader}>
                    <div className={styles.settingCopy}>
                      <p>
                        {cursorByokStatus === "loading" ? "Checking Cursor access…"
                          : cursorByokStatus === "unavailable" ? "Couldn't check Cursor key source. Reload Settings to try again."
                          : cursorByok.present
                          ? "Cursor requests use your encrypted personal API key."
                          : cursorByok.fallback_available
                            ? "Cursor requests use the shared server key."
                            : "Add a personal API key to enable Cursor models."}
                      </p>
                    </div>
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
              </div>
            </div>

            <div className={styles.divider} />

            <div className={styles.stackedSetting}>
              <div className={styles.stackedHeader}>
                <div className={styles.settingCopy}>
                  <h3>Instructions</h3>
                  <p>
                    Give Coach persistent context about how you want it to
                    think and respond. This is added to Coach&rsquo;s built-in
                    instructions, not a replacement for them. Leave it empty
                    to use Coach as-is.
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
                placeholder="e.g. Keep answers to three sentences. Always mention my HRV trend."
                spellCheck={false}
              />
              <div className={styles.promptActions}>
                <span>Changes apply to your next message.</span>
                <div className={styles.actionGroup}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => setSystemPrompt("")}
                    disabled={systemPrompt === ""}
                  >
                    Clear
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
