export type CursorModelParameterSelection = {
  id: string;
  value: string;
};

export type CursorModelParameterValue = {
  value: string;
  display_name: string | null;
};

export type CursorModelParameterDefinition = {
  id: string;
  display_name: string | null;
  values: CursorModelParameterValue[];
};

export type CursorModelVariant = {
  params: CursorModelParameterSelection[];
  display_name: string;
  description: string | null;
  is_default: boolean;
};

export type CursorModelOption = {
  id: string;
  display_name: string;
  description: string | null;
  parameters: CursorModelParameterDefinition[];
  variants: CursorModelVariant[];
};

export type CursorModelParamsByModel = Record<
  string,
  CursorModelParameterSelection[]
>;

const SAFE_PARAMETER_TOKEN = /^[A-Za-z0-9._:/-]+$/;
const MAX_MODELS = 100;
const MAX_PARAMETERS_PER_MODEL = 8;

export function isSafeCursorParameterToken(value: string): boolean {
  return (
    value.length > 0 && value.length <= 100 && SAFE_PARAMETER_TOKEN.test(value)
  );
}

export function isCursorReasoningParameter(
  parameter: Pick<CursorModelParameterDefinition, "id" | "display_name">,
): boolean {
  const id = parameter.id.trim().toLowerCase();
  const name = (parameter.display_name ?? "").trim().toLowerCase();
  return (
    id === "thinking" ||
    id === "reasoning" ||
    id === "effort" ||
    id === "thought_level" ||
    name.includes("thinking") ||
    name.includes("reasoning") ||
    name.includes("thought") ||
    name.includes("effort")
  );
}

export function cursorBooleanParameterValues(
  parameter: Pick<CursorModelParameterDefinition, "values">,
): { on: CursorModelParameterValue; off: CursorModelParameterValue } | null {
  if (parameter.values.length !== 2) return null;
  const on = parameter.values.find(
    (candidate) => candidate.value.trim().toLowerCase() === "true",
  );
  const off = parameter.values.find(
    (candidate) => candidate.value.trim().toLowerCase() === "false",
  );
  return on && off ? { on, off } : null;
}

export function cursorReasoningValueLabel(
  parameter: Pick<CursorModelParameterDefinition, "values">,
  value: string,
): string {
  const booleanValues = cursorBooleanParameterValues(parameter);
  if (booleanValues) {
    if (value === booleanValues.on.value) return "Reasoning on";
    if (value === booleanValues.off.value) return "Reasoning off";
  }
  return (
    parameter.values.find((candidate) => candidate.value === value)
      ?.display_name ?? value
  );
}

export function defaultCursorModelParameters(
  model: Pick<CursorModelOption, "variants">,
): CursorModelParameterSelection[] {
  return (
    model.variants.find((variant) => variant.is_default)?.params ??
    model.variants[0]?.params ??
    []
  );
}

export function cursorModelParametersFor(
  byModel: CursorModelParamsByModel,
  model: Pick<CursorModelOption, "id" | "variants">,
): CursorModelParameterSelection[] {
  return byModel[model.id] ?? defaultCursorModelParameters(model);
}

export function parseCursorModelParamsByModel(
  value: unknown,
): CursorModelParamsByModel {
  if (typeof value === "string") {
    try {
      return parseCursorModelParamsByModel(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const result: CursorModelParamsByModel = {};
  for (const [model, rawParams] of Object.entries(value).slice(0, MAX_MODELS)) {
    if (
      !model ||
      model.length > 200 ||
      /[\s\x00-\x1f\[\],=]/.test(model) ||
      !Array.isArray(rawParams)
    ) {
      continue;
    }

    const seen = new Set<string>();
    const params: CursorModelParameterSelection[] = [];
    for (const rawParam of rawParams.slice(0, MAX_PARAMETERS_PER_MODEL)) {
      if (
        !rawParam ||
        typeof rawParam !== "object" ||
        Array.isArray(rawParam)
      ) {
        continue;
      }
      const { id, value: rawValue } = rawParam as {
        id?: unknown;
        value?: unknown;
      };
      if (
        typeof id !== "string" ||
        typeof rawValue !== "string" ||
        !isSafeCursorParameterToken(id) ||
        !isSafeCursorParameterToken(rawValue) ||
        seen.has(id)
      ) {
        continue;
      }
      seen.add(id);
      params.push({ id, value: rawValue });
    }
    result[model] = params;
  }
  return result;
}

export function cursorModelArgument(
  model: string,
  params: CursorModelParameterSelection[] = [],
): string {
  if (params.length === 0) return model;
  if (!model || /[\s\x00-\x1f\[\],=]/.test(model)) {
    throw new Error("Invalid Cursor model ID");
  }
  for (const parameter of params) {
    if (
      !isSafeCursorParameterToken(parameter.id) ||
      !isSafeCursorParameterToken(parameter.value)
    ) {
      throw new Error("Invalid Cursor model parameter");
    }
  }
  return `${model}[${params
    .map(({ id, value }) => `${id}=${value}`)
    .join(",")}]`;
}
