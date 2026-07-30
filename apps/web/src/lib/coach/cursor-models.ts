import "server-only";

export type CursorModelOption = {
  id: string;
  display_name: string;
  description: string | null;
};

type CursorApiModel = {
  id?: unknown;
  displayName?: unknown;
  description?: unknown;
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
  };
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
