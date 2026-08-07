import "server-only";
import {
  isSafeCursorParameterToken,
  type CursorModelOption,
  type CursorModelParameterDefinition,
  type CursorModelParameterSelection,
  type CursorModelVariant,
} from "./cursor-model-params";

export type { CursorModelOption } from "./cursor-model-params";

type CursorApiModel = {
  id?: unknown;
  displayName?: unknown;
  description?: unknown;
  parameters?: unknown;
  variants?: unknown;
};

export type CursorModelCatalogFailure = "invalid_key" | "unavailable";

export class CursorModelCatalogError extends Error {
  constructor(
    public readonly reason: CursorModelCatalogFailure,
    message: string,
  ) {
    super(message);
    this.name = "CursorModelCatalogError";
  }
}

function toOption(model: CursorApiModel): CursorModelOption | null {
  if (typeof model.id !== "string" || typeof model.displayName !== "string") {
    return null;
  }
  const id = model.id.trim();
  const displayName = model.displayName.trim();
  if (!id || id.startsWith("-") || !displayName) return null;
  return {
    id,
    display_name: displayName,
    description:
      typeof model.description === "string"
        ? model.description.trim() || null
        : null,
    parameters: toParameters(model.parameters),
    variants: toVariants(model.variants),
  };
}

function toParameterSelections(value: unknown): CursorModelParameterSelection[] {
  if (!Array.isArray(value)) return [];
  const selections: CursorModelParameterSelection[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const { id, value: rawValue } = item as { id?: unknown; value?: unknown };
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
    selections.push({ id, value: rawValue });
  }
  return selections;
}

function toParameters(value: unknown): CursorModelParameterDefinition[] {
  if (!Array.isArray(value)) return [];
  const definitions: CursorModelParameterDefinition[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const { id, displayName, values } = item as {
      id?: unknown;
      displayName?: unknown;
      values?: unknown;
    };
    if (
      typeof id !== "string" ||
      !isSafeCursorParameterToken(id) ||
      seen.has(id) ||
      !Array.isArray(values)
    ) {
      continue;
    }
    const parameterValues = values.flatMap((rawValue) => {
      if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
        return [];
      }
      const { value: parameterValue, displayName: valueDisplayName } = rawValue as {
        value?: unknown;
        displayName?: unknown;
      };
      if (
        typeof parameterValue !== "string" ||
        !isSafeCursorParameterToken(parameterValue)
      ) {
        return [];
      }
      return [{
        value: parameterValue,
        display_name:
          typeof valueDisplayName === "string"
            ? valueDisplayName.trim() || null
            : null,
      }];
    });
    if (parameterValues.length === 0) continue;
    seen.add(id);
    definitions.push({
      id,
      display_name:
        typeof displayName === "string" ? displayName.trim() || null : null,
      values: parameterValues,
    });
  }
  return definitions;
}

function toVariants(value: unknown): CursorModelVariant[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const { params, displayName, description, isDefault } = item as {
      params?: unknown;
      displayName?: unknown;
      description?: unknown;
      isDefault?: unknown;
    };
    if (typeof displayName !== "string" || !displayName.trim()) return [];
    return [{
      params: toParameterSelections(params),
      display_name: displayName.trim(),
      description:
        typeof description === "string" ? description.trim() || null : null,
      is_default: isDefault === true,
    }];
  });
}

/**
 * Fetch the live account-scoped model catalog. This mirrors the official
 * Cursor SDK's `Cursor.models.list()` call (`GET /v1/models`) without taking
 * its Node 22-only runtime dependency; production currently runs Node 20.
 * Never cache this response across users or key origins.
 */
export async function listCursorModelsForKey(
  apiKey: string,
): Promise<CursorModelOption[]> {
  let response: Response;
  try {
    const baseUrl =
      process.env.CURSOR_BACKEND_URL?.replace(/\/+$/, "") ||
      "https://api.cursor.com";
    response = await fetch(`${baseUrl}/v1/models`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new CursorModelCatalogError(
      "unavailable",
      "Cursor model discovery is unavailable",
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new CursorModelCatalogError(
      "invalid_key",
      "Cursor rejected the API key",
    );
  }
  if (!response.ok) {
    throw new CursorModelCatalogError(
      "unavailable",
      "Cursor model discovery is unavailable",
    );
  }

  let models: CursorApiModel[];
  try {
    const body = (await response.json()) as { items?: unknown };
    if (!Array.isArray(body.items)) throw new Error("Invalid model catalog");
    models = body.items as CursorApiModel[];
  } catch {
    throw new CursorModelCatalogError(
      "unavailable",
      "Cursor model discovery is unavailable",
    );
  }

  const seen = new Set<string>();
  const options: CursorModelOption[] = [];
  for (const model of models) {
    const option = toOption(model);
    if (!option || seen.has(option.id)) continue;
    seen.add(option.id);
    options.push(option);
  }
  return options;
}
