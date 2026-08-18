import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import {
  isCursorReasoningParameter,
  type CursorModelOption,
  type CursorModelParameterDefinition,
  type CursorModelParameterSelection,
} from "./cursor-model-params";

export type CursorAcpAvailableModel = {
  value: string;
  name: string;
  configOptions?: SessionConfigOption[];
};

export type CursorAcpAvailableModelsResponse = {
  models: CursorAcpAvailableModel[];
};

function normalize(value: string | null | undefined): string {
  return (
    value
      ?.trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "-") ?? ""
  );
}

export function flattenCursorAcpOptions(
  option: SessionConfigOption,
): Array<{ value: string; name: string; description: string | null }> {
  if (option.type === "boolean") {
    return [
      { value: "true", name: "On", description: null },
      { value: "false", name: "Off", description: null },
    ];
  }
  return option.options.flatMap((item) => {
    if ("group" in item) {
      return item.options.map((nested) => ({
        value: nested.value,
        name: nested.name,
        description: nested.description ?? null,
      }));
    }
    return [
      {
        value: item.value,
        name: item.name,
        description: item.description ?? null,
      },
    ];
  });
}

function isModelSelector(option: SessionConfigOption): boolean {
  return option.category === "model" || normalize(option.id) === "model";
}

function isModeSelector(option: SessionConfigOption): boolean {
  return option.category === "mode" || normalize(option.id) === "mode";
}

function parameterFromConfig(
  option: SessionConfigOption,
): CursorModelParameterDefinition | null {
  if (isModelSelector(option) || isModeSelector(option)) return null;
  const values = flattenCursorAcpOptions(option).map((value) => ({
    value: value.value,
    display_name: value.name || value.value,
  }));
  if (values.length === 0) return null;
  return {
    id: option.id,
    display_name: option.name || null,
    values,
  };
}

export function cursorModelsFromAcp(
  response: CursorAcpAvailableModelsResponse,
): CursorModelOption[] {
  const seen = new Set<string>();
  return response.models.flatMap((model) => {
    const id = model.value.trim();
    const displayName = model.name.trim();
    if (!id || !displayName || seen.has(id)) return [];
    seen.add(id);
    const configOptions = model.configOptions ?? [];
    const parameters = configOptions.flatMap((option) => {
      const parameter = parameterFromConfig(option);
      return parameter ? [parameter] : [];
    });
    const defaults = configOptions.flatMap((option) => {
      if (
        !parameterFromConfig(option) ||
        option.currentValue === null ||
        option.currentValue === undefined
      ) {
        return [];
      }
      return [
        {
          id: option.id,
          value: String(option.currentValue),
        },
      ];
    });
    return [
      {
        id,
        display_name: displayName,
        description: null,
        parameters,
        variants:
          defaults.length > 0
            ? [
                {
                  params: defaults,
                  display_name: "Default",
                  description: null,
                  is_default: true,
                },
              ]
            : [],
      },
    ];
  });
}

export function findCursorAcpConfigOption(
  options: readonly SessionConfigOption[],
  selection: CursorModelParameterSelection,
): SessionConfigOption | undefined {
  const exact = options.find((option) => option.id === selection.id);
  if (exact) return exact;
  const requested = normalize(selection.id);
  return options.find((option) => {
    if (isModelSelector(option) || isModeSelector(option)) return false;
    if (
      normalize(option.id) === requested ||
      normalize(option.name) === requested
    ) {
      return true;
    }
    if (
      isCursorReasoningParameter({
        id: selection.id,
        display_name: selection.id,
      })
    ) {
      return isCursorReasoningParameter({
        id: option.id,
        display_name: option.name,
      });
    }
    return false;
  });
}

export function cursorAcpConfigValue(
  option: SessionConfigOption,
  requested: string,
): string | boolean | null {
  if (option.type === "boolean") {
    if (requested.toLowerCase() === "true") return true;
    if (requested.toLowerCase() === "false") return false;
    return null;
  }
  const direct = flattenCursorAcpOptions(option).find(
    (candidate) =>
      candidate.value === requested ||
      normalize(candidate.value) === normalize(requested) ||
      normalize(candidate.name) === normalize(requested),
  );
  return direct?.value ?? null;
}

export function findCursorAcpModelOption(
  options: readonly SessionConfigOption[],
): SessionConfigOption | undefined {
  return options.find(isModelSelector);
}
