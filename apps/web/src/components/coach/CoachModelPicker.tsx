"use client";

import { BrainCircuit, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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

type Props = {
  initialModelPref: string;
  disabled: boolean;
  onSavingChange: (saving: boolean) => void;
};

const STATUS_TITLE: Record<CursorModelCatalogStatus, string> = {
  loading: "Loading models available to your Cursor account…",
  ready: "Choose the model for your next Coach reply.",
  not_configured: "Add a Cursor API key in Settings to enable more models.",
  invalid_key: "Cursor rejected the configured API key.",
  unavailable: "Cursor model discovery is temporarily unavailable.",
};

function cursorModelId(modelPref: string): string | null {
  return modelPref.startsWith("cursor:")
    ? modelPref.slice("cursor:".length)
    : null;
}

export default function CoachModelPicker({
  initialModelPref,
  disabled,
  onSavingChange,
}: Props) {
  const [modelPref, setModelPref] = useState(initialModelPref);
  const [cursorModels, setCursorModels] = useState<CursorModel[]>([]);
  const [catalogStatus, setCatalogStatus] =
    useState<CursorModelCatalogStatus>("loading");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const options = useMemo(() => {
    const cursorOptions = cursorModels.map((model) => ({
      value: `cursor:${model.id}`,
      label: `Cursor — ${model.display_name}`,
    }));
    const selectedCursorId = cursorModelId(modelPref);
    if (
      selectedCursorId &&
      !cursorModels.some((model) => model.id === selectedCursorId)
    ) {
      cursorOptions.push({
        value: modelPref,
        label: `Cursor — ${selectedCursorId} (saved)`,
      });
    }
    return [
      { value: ANTHROPIC_PREF, label: "Claude Sonnet 4.6" },
      ...cursorOptions,
    ];
  }, [cursorModels, modelPref]);

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

  return (
    <div className="coach-model-control">
      <label
        className="coach-model-picker"
        title={error ?? STATUS_TITLE[catalogStatus]}
      >
        <BrainCircuit size={15} strokeWidth={1.8} aria-hidden />
        <span className="coach-model-label">Model</span>
        <select
          value={modelPref}
          disabled={disabled || saving}
          aria-label="Coach model"
          onChange={(event) => void saveModelPref(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          className="coach-model-chevron"
          size={14}
          strokeWidth={1.8}
          aria-hidden
        />
      </label>
      {error ? (
        <span className="coach-model-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
