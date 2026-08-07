"use client";

import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  LoaderCircle,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CoachEffort } from "@/lib/coach/provider";
import {
  cursorModelParametersFor,
  isCursorReasoningParameter,
  type CursorModelOption,
  type CursorModelParameterDefinition,
  type CursorModelParamsByModel,
} from "@/lib/coach/cursor-model-params";

const ANTHROPIC_PREF = "anthropic:claude-sonnet-4-6";

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
  cursorModel?: CursorModelOption;
};

type Props = {
  initialModelPref: string;
  initialCoachEffort: CoachEffort;
  initialCursorModelParams?: CursorModelParamsByModel;
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
  initialCursorModelParams = {},
  disabled,
  onSavingChange,
}: Props) {
  const menuId = useId();
  const customizationId = useId();
  const controlRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const customizeButtonRef = useRef<HTMLButtonElement>(null);
  const customizationBackRef = useRef<HTMLButtonElement>(null);
  const restoreCustomizationFocusRef = useRef(false);
  const [modelPref, setModelPref] = useState(initialModelPref);
  const [coachEffort, setCoachEffort] = useState(initialCoachEffort);
  const [cursorModelParams, setCursorModelParams] = useState(
    initialCursorModelParams,
  );
  const [cursorModels, setCursorModels] = useState<CursorModelOption[]>([]);
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
          models: CursorModelOption[];
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
      cursorModel: model,
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
      });
    }
    return [
      {
        value: ANTHROPIC_PREF,
        label: "Claude Sonnet 4.6",
        provider: "Anthropic",
      },
      ...cursorOptions,
    ];
  }, [cursorModels, modelPref]);

  const selectedOption =
    options.find((option) => option.value === modelPref) ?? options[0];
  const selectedCursorReasoning = (
    selectedOption.cursorModel?.parameters ?? []
  ).find(isCursorReasoningParameter);
  const selectedCursorParameterValue =
    selectedOption.cursorModel && selectedCursorReasoning
      ? cursorModelParametersFor(
          cursorModelParams,
          selectedOption.cursorModel,
        ).find((parameter) => parameter.id === selectedCursorReasoning.id)?.value
      : undefined;
  const selectedCursorEffortLabel = selectedCursorReasoning?.values.find(
    (value) => value.value === selectedCursorParameterValue,
  )?.display_name ?? selectedCursorParameterValue;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !controlRef.current?.contains(event.target)
      ) {
        restoreCustomizationFocusRef.current = false;
        setOpen(false);
        setCustomizingModelPref(null);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (customizingModelPref) {
        restoreCustomizationFocusRef.current = true;
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

  useEffect(() => {
    if (!open) return;

    if (customizingModelPref) {
      customizationBackRef.current?.focus();
      return;
    }

    if (restoreCustomizationFocusRef.current) {
      restoreCustomizationFocusRef.current = false;
      customizeButtonRef.current?.focus();
    }
  }, [customizingModelPref, open]);

  useEffect(() => {
    const control = controlRef.current;
    const trigger = triggerRef.current;
    if (!open || !control || !trigger) return;

    const updateMobilePlacement = () => {
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportLeft = viewport?.offsetLeft ?? 0;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportWidth = viewport?.width ?? window.innerWidth;
      const viewportBottom = viewportTop + viewportHeight;
      const viewportRight = viewportLeft + viewportWidth;
      const triggerRect = trigger.getBoundingClientRect();
      const panelBottom = Math.max(
        viewportTop + 108,
        Math.min(triggerRect.top - 10, viewportBottom - 12),
      );
      const availableHeight = Math.max(
        96,
        Math.floor(panelBottom - viewportTop - 12),
      );
      const rightInset = Math.max(
        16,
        Math.floor(
          window.innerWidth - Math.min(triggerRect.right, viewportRight - 16),
        ),
      );
      const bottomInset = Math.max(
        12,
        Math.floor(window.innerHeight - panelBottom),
      );

      control.style.setProperty(
        "--coach-model-mobile-max-height",
        `${availableHeight}px`,
      );
      control.style.setProperty(
        "--coach-model-mobile-max-width",
        `${Math.max(1, Math.floor(viewportWidth - 32))}px`,
      );
      control.style.setProperty(
        "--coach-model-mobile-right",
        `${rightInset}px`,
      );
      control.style.setProperty(
        "--coach-model-mobile-bottom",
        `${bottomInset}px`,
      );
    };

    updateMobilePlacement();
    window.addEventListener("resize", updateMobilePlacement);
    window.visualViewport?.addEventListener("resize", updateMobilePlacement);
    window.visualViewport?.addEventListener("scroll", updateMobilePlacement);
    return () => {
      window.removeEventListener("resize", updateMobilePlacement);
      window.visualViewport?.removeEventListener(
        "resize",
        updateMobilePlacement,
      );
      window.visualViewport?.removeEventListener(
        "scroll",
        updateMobilePlacement,
      );
      control.style.removeProperty("--coach-model-mobile-max-height");
      control.style.removeProperty("--coach-model-mobile-max-width");
      control.style.removeProperty("--coach-model-mobile-right");
      control.style.removeProperty("--coach-model-mobile-bottom");
    };
  }, [open]);

  const customizingOption =
    options.find((option) => option.value === customizingModelPref) ?? null;
  const customizingCursorReasoning =
    (customizingOption?.cursorModel?.parameters ?? []).find(
      isCursorReasoningParameter,
    ) ?? null;

  function closeMenu() {
    restoreCustomizationFocusRef.current = false;
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

  async function saveCursorParameter(
    model: CursorModelOption,
    parameter: CursorModelParameterDefinition,
    nextValue: string,
  ) {
    if (saving) return;
    const previousParams = cursorModelParams;
    const currentParams = cursorModelParametersFor(cursorModelParams, model);
    const nextParams = [
      ...currentParams.filter((candidate) => candidate.id !== parameter.id),
      { id: parameter.id, value: nextValue },
    ];
    setCursorModelParams({
      ...cursorModelParams,
      [model.id]: nextParams,
    });
    setSaving(true);
    setError(null);
    onSavingChange(true);

    try {
      const response = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cursor_model_params: {
            model_id: model.id,
            params: nextParams,
          },
        }),
      });
      const data = (await response.json().catch(() => null)) as
        | { cursor_model_params?: CursorModelParamsByModel; error?: string }
        | null;
      if (!response.ok) {
        throw new Error(
          data?.error ||
            `Couldn't change Cursor reasoning (HTTP ${response.status}).`,
        );
      }
      setCursorModelParams(
        data?.cursor_model_params ?? {
          ...cursorModelParams,
          [model.id]: nextParams,
        },
      );
    } catch (saveError) {
      setCursorModelParams(previousParams);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Couldn't change Cursor reasoning.",
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
            : selectedCursorParameterValue
              ? `; effort ${selectedCursorParameterValue}`
              : ""
        }`}
        aria-controls={menuId}
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
        {selectedOption.provider === "Anthropic" || selectedCursorEffortLabel ? (
          <span className="coach-model-trigger-effort">
            {saving
              ? "Saving…"
              : selectedOption.provider === "Anthropic"
                ? EFFORT_OPTIONS.find(
                    (option) => option.value === coachEffort,
                  )?.label
                : selectedCursorEffortLabel}
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
          id={menuId}
          role="region"
          aria-label="Choose a model"
        >
          <div className="coach-model-menu-heading">
            <span>Choose a model</span>
            <small>Used for your next Coach reply</small>
          </div>
          <div
            className="coach-model-options"
            role="group"
            aria-label="Coach models"
          >
            {(["Anthropic", "Cursor"] as const).map((provider) => {
              const providerOptions = options.filter(
                (option) => option.provider === provider,
              );
              if (providerOptions.length === 0) return null;

              return (
                <div
                  className="coach-model-option-group"
                  role="group"
                  aria-label={`${provider} models`}
                  key={provider}
                >
                  <div className="coach-model-option-group-label" aria-hidden>
                    {provider}
                  </div>
                  <div className="coach-model-option-group-rows">
                    {providerOptions.map((option) => {
                      const selected = option.value === modelPref;
                      return (
                        <div
                          key={option.value}
                          className={`coach-model-option ${
                            selected ? "is-selected" : ""
                          }`}
                        >
                          <button
                            type="button"
                            aria-pressed={selected}
                            aria-label={`Select ${option.label}`}
                            className="coach-model-option-select"
                            onClick={() => {
                              closeMenu();
                              void saveModelPref(option.value);
                            }}
                          >
                            <strong>{option.label}</strong>
                            <span
                              className="coach-model-option-check"
                              aria-hidden
                            >
                              {selected ? (
                                <Check size={15} strokeWidth={2.2} />
                              ) : null}
                            </span>
                          </button>
                          {option.provider === "Anthropic" ||
                          ((option.cursorModel?.parameters ?? []).find(
                            isCursorReasoningParameter,
                          )?.values.length ?? 0) > 1 ? (
                            <button
                              ref={customizeButtonRef}
                              type="button"
                              className="coach-model-customize"
                              aria-label={`Customize ${option.label}`}
                              aria-controls={customizationId}
                              aria-expanded={
                                customizingModelPref === option.value
                              }
                              onClick={() => {
                                restoreCustomizationFocusRef.current = false;
                                setCustomizingModelPref(option.value);
                              }}
                            >
                              <ChevronLeft
                                size={16}
                                strokeWidth={1.8}
                                aria-hidden
                              />
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
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

      {open &&
      (customizingOption?.provider === "Anthropic" ||
        (customizingOption?.cursorModel && customizingCursorReasoning)) ? (
        <div
          className="coach-model-customization-menu"
          id={customizationId}
          role="region"
          aria-label={`${customizingOption.label} customization`}
        >
          <div className="coach-model-customization-heading">
            <button
              ref={customizationBackRef}
              type="button"
              onClick={() => {
                restoreCustomizationFocusRef.current = true;
                setCustomizingModelPref(null);
              }}
              aria-label="Back to models"
            >
              <ChevronRight
                className="coach-model-back-icon"
                size={16}
                strokeWidth={1.8}
                aria-hidden
              />
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
              {(customizingOption.provider === "Anthropic"
                ? EFFORT_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                    description: option.description,
                    selected: coachEffort === option.value,
                  }))
                : (customizingCursorReasoning?.values ?? []).map((option) => {
                    const selected = cursorModelParametersFor(
                      cursorModelParams,
                      customizingOption.cursorModel!,
                    ).some(
                      (parameter) =>
                        parameter.id === customizingCursorReasoning?.id &&
                        parameter.value === option.value,
                    );
                    return {
                      value: option.value,
                      label: option.display_name ?? option.value,
                      description:
                        option.value === "none" || option.value === "false"
                          ? "No extended reasoning"
                          : option.value === "low"
                            ? "Fastest"
                            : option.value === "medium"
                              ? "Balanced"
                              : option.value === "high"
                                ? "Thorough"
                                : "Deepest",
                      selected,
                    };
                  })
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={option.selected}
                  className={
                    option.selected ? "is-selected" : ""
                  }
                  disabled={saving}
                  onClick={() => {
                    if (customizingOption.provider === "Anthropic") {
                      void saveCoachEffort(option.value as CoachEffort);
                    } else if (
                      customizingOption.cursorModel &&
                      customizingCursorReasoning
                    ) {
                      void saveCursorParameter(
                        customizingOption.cursorModel,
                        customizingCursorReasoning,
                        option.value,
                      );
                    }
                  }}
                >
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  {option.selected ? (
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
