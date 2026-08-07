"use client";

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CoachEffort } from "@/lib/coach/provider";

const ANTHROPIC_PREF = "anthropic:claude-sonnet-4-6";

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

type ModelOption = {
  value: string;
  label: string;
  provider: "Anthropic" | "Cursor";
  description: string;
};

type Props = {
  initialModelPref: string;
  initialCoachEffort: CoachEffort;
  disabled: boolean;
  onSavingChange: (saving: boolean) => void;
};

const EFFORT_OPTIONS: Array<{
  value: CoachEffort;
  label: string;
  description: string;
}> = [
  { value: "off", label: "None", description: "No extended reasoning" },
  { value: "low", label: "Low", description: "Fastest" },
  { value: "medium", label: "Medium", description: "Balanced" },
  { value: "high", label: "High", description: "Thorough" },
  { value: "max", label: "Max", description: "Deepest" },
];

const STATUS_TITLE: Record<CursorModelCatalogStatus, string> = {
  loading: "Loading models available to your Cursor account…",
  ready: "Choose the model for your next Coach reply.",
  not_configured: "Add a Cursor API key in Settings to enable more models.",
  invalid_key: "Cursor rejected the configured API key.",
  unavailable: "Cursor model discovery is temporarily unavailable.",
};

const STATUS_DETAIL: Record<
  Exclude<CursorModelCatalogStatus, "ready">,
  { title: string; detail: string }
> = {
  loading: {
    title: "Checking Cursor models",
    detail: "Looking up the models available to your Cursor account.",
  },
  not_configured: {
    title: "Connect Cursor for more models",
    detail: "Add a Cursor API key to unlock its live model catalog.",
  },
  invalid_key: {
    title: "Cursor key needs attention",
    detail: "The configured key was rejected, so only Claude is available.",
  },
  unavailable: {
    title: "Cursor catalog is offline",
    detail: "Claude is available while model discovery recovers.",
  },
};

function cursorModelId(modelPref: string): string | null {
  return modelPref.startsWith("cursor:")
    ? modelPref.slice("cursor:".length)
    : null;
}

export default function CoachModelPicker({
  initialModelPref,
  initialCoachEffort,
  disabled,
  onSavingChange,
}: Props) {
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [modelPref, setModelPref] = useState(initialModelPref);
  const [coachEffort, setCoachEffort] = useState(initialCoachEffort);
  const [cursorModels, setCursorModels] = useState<CursorModel[]>([]);
  const [catalogStatus, setCatalogStatus] =
    useState<CursorModelCatalogStatus>("loading");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [customizingModelPref, setCustomizingModelPref] = useState<
    string | null
  >(null);

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/me/cursor-models", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as {
          status: Exclude<CursorModelCatalogStatus, "loading">;
          models: CursorModel[];
        };
      })
      .then((data) => {
        setCursorModels(data.models);
        setCatalogStatus(data.status);
      })
      .catch((fetchError: unknown) => {
        if (
          fetchError instanceof DOMException &&
          fetchError.name === "AbortError"
        ) {
          return;
        }
        setCursorModels([]);
        setCatalogStatus("unavailable");
      });

    return () => controller.abort();
  }, []);

  const options = useMemo<ModelOption[]>(() => {
    const cursorOptions: ModelOption[] = cursorModels.map((model) => ({
      value: `cursor:${model.id}`,
      label: model.display_name,
      provider: "Cursor",
      description:
        model.description || "Available through your Cursor account.",
    }));
    const selectedCursorId = cursorModelId(modelPref);
    if (
      selectedCursorId &&
      !cursorModels.some((model) => model.id === selectedCursorId)
    ) {
      cursorOptions.push({
        value: modelPref,
        label: selectedCursorId,
        provider: "Cursor",
        description: "Saved model. It is not in the current live catalog.",
      });
    }
    return [
      {
        value: ANTHROPIC_PREF,
        label: "Claude Sonnet 4.6",
        provider: "Anthropic",
        description: "Balanced reasoning for thoughtful health coaching.",
      },
      ...cursorOptions,
    ];
  }, [cursorModels, modelPref]);

  const selectedOption =
    options.find((option) => option.value === modelPref) ?? options[0];

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !controlRef.current?.contains(event.target)
      ) {
        setOpen(false);
        setCustomizingModelPref(null);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (customizingModelPref) {
        setCustomizingModelPref(null);
        return;
      }
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [customizingModelPref, open]);

  const customizingOption =
    options.find((option) => option.value === customizingModelPref) ?? null;

  function closeMenu() {
    setOpen(false);
    setCustomizingModelPref(null);
  }

  async function saveModelPref(nextModelPref: string) {
    if (nextModelPref === modelPref || saving) return;

    const previousModelPref = modelPref;
    setModelPref(nextModelPref);
    setSaving(true);
    setError(null);
    onSavingChange(true);

    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_pref: nextModelPref }),
      });
      const data = (await response.json().catch(() => null)) as
        | { model_pref?: string; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          data?.error || `Couldn't switch models (HTTP ${response.status}).`,
        );
      }
      setModelPref(data?.model_pref || nextModelPref);
    } catch (saveError) {
      setModelPref(previousModelPref);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Couldn't switch models.",
      );
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  }

  async function saveCoachEffort(nextEffort: CoachEffort) {
    if (nextEffort === coachEffort || saving) return;

    const previousEffort = coachEffort;
    setCoachEffort(nextEffort);
    setSaving(true);
    setError(null);
    onSavingChange(true);

    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coach_effort: nextEffort }),
      });
      const data = (await response.json().catch(() => null)) as
        | { coach_effort?: CoachEffort; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          data?.error || `Couldn't change effort (HTTP ${response.status}).`,
        );
      }
      setCoachEffort(data?.coach_effort || nextEffort);
    } catch (saveError) {
      setCoachEffort(previousEffort);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Couldn't change effort.",
      );
    } finally {
      setSaving(false);
      onSavingChange(false);
    }
  }

  return (
    <div className="coach-model-control" ref={controlRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`coach-model-trigger ${
          selectedOption.provider === "Cursor" ? "is-cursor" : ""
        }`}
        aria-label={`Coach model: ${selectedOption.label}${
          selectedOption.provider === "Anthropic"
            ? `; effort ${coachEffort}`
            : ""
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled || saving}
        title={error ?? STATUS_TITLE[catalogStatus]}
        onClick={() => {
          if (open) closeMenu();
          else setOpen(true);
        }}
      >
        <span className="coach-model-trigger-name">
          {selectedOption.label.replace(/^Claude /, "")}
        </span>
        {selectedOption.provider === "Anthropic" ? (
          <span className="coach-model-trigger-effort">
            {saving
              ? "Saving…"
              : EFFORT_OPTIONS.find(
                  (option) => option.value === coachEffort,
                )?.label}
          </span>
        ) : null}
        <ChevronDown
          className="coach-model-chevron"
          size={13}
          strokeWidth={1.8}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          className={`coach-model-menu ${
            customizingOption ? "is-customizing" : ""
          }`}
        >
          <div className="coach-model-menu-heading">
            <span>Choose a model</span>
            <small>Used for your next Coach reply</small>
          </div>
          <div
            className="coach-model-options"
            role="listbox"
            aria-label="Coach models"
          >
            {options.map((option) => {
              const selected = option.value === modelPref;
              return (
                <div
                  key={option.value}
                  role="option"
                  aria-selected={selected}
                  aria-label={`${option.label}${
                    selected ? ", selected" : ""
                  }`}
                  className={`coach-model-option ${
                    selected ? "is-selected" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="coach-model-option-select"
                    aria-label={`Select ${option.label}`}
                    onClick={() => {
                      closeMenu();
                      void saveModelPref(option.value);
                    }}
                  >
                    <span
                      className={`coach-model-provider-mark ${
                        option.provider === "Cursor" ? "is-cursor" : ""
                      }`}
                      aria-hidden
                    >
                      {option.provider === "Cursor" ? "C" : "A"}
                    </span>
                    <span className="coach-model-option-copy">
                      <span className="coach-model-option-meta">
                        {option.provider}
                      </span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </button>
                  {option.provider === "Anthropic" ? (
                    <button
                      type="button"
                      className="coach-model-customize"
                      aria-label={`Customize ${option.label}`}
                      aria-haspopup="menu"
                      aria-expanded={customizingModelPref === option.value}
                      onClick={() => setCustomizingModelPref(option.value)}
                    >
                      {selected ? (
                        <Check size={14} strokeWidth={2.2} aria-hidden />
                      ) : null}
                      <ChevronRight size={15} strokeWidth={1.8} aria-hidden />
                    </button>
                  ) : (
                    <span className="coach-model-option-check" aria-hidden>
                      {selected ? <Check size={15} strokeWidth={2.2} /> : null}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {catalogStatus !== "ready" ? (
            <div className={`coach-model-catalog-state is-${catalogStatus}`}>
              <span className="coach-model-catalog-icon" aria-hidden>
                {catalogStatus === "loading" ? (
                  <LoaderCircle size={15} strokeWidth={1.8} />
                ) : (
                  <KeyRound size={15} strokeWidth={1.8} />
                )}
              </span>
              <span>
                <strong>{STATUS_DETAIL[catalogStatus].title}</strong>
                <small>{STATUS_DETAIL[catalogStatus].detail}</small>
              </span>
              {catalogStatus === "not_configured" ||
              catalogStatus === "invalid_key" ? (
                <a href="/settings">Manage key</a>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {open && customizingOption?.provider === "Anthropic" ? (
        <div
          className="coach-model-customization-menu"
          role="menu"
          aria-label={`${customizingOption.label} customization`}
        >
          <div className="coach-model-customization-heading">
            <button
              type="button"
              onClick={() => setCustomizingModelPref(null)}
              aria-label="Back to models"
            >
              <ChevronLeft size={15} strokeWidth={1.8} aria-hidden />
            </button>
            <span>
              <small>Customize</small>
              <strong>{customizingOption.label}</strong>
            </span>
          </div>
          <div className="coach-effort-section">
            <div className="coach-effort-heading">
              <span>Reasoning</span>
              <small>Applied to the next reply using this model</small>
            </div>
            <div
              className="coach-effort-options"
              role="radiogroup"
              aria-label="Thinking effort"
            >
              {EFFORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={coachEffort === option.value}
                  className={
                    coachEffort === option.value ? "is-selected" : ""
                  }
                  disabled={saving}
                  onClick={() => void saveCoachEffort(option.value)}
                >
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  {coachEffort === option.value ? (
                    <Check size={14} strokeWidth={2.2} aria-hidden />
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <span className="coach-model-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
