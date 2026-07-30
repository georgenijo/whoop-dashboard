import "server-only";

import {
  AuthenticationError,
  Cursor,
  CursorSdkError,
  type SDKModel,
} from "@cursor/sdk";

export type CursorModelOption = {
  id: string;
  display_name: string;
  description: string | null;
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

function isAuthenticationFailure(error: unknown): boolean {
  if (error instanceof AuthenticationError) return true;
  if (!(error instanceof CursorSdkError)) return false;
  return (
    error.status === 401 ||
    error.status === 403 ||
    error.code === "unauthenticated" ||
    error.code === "unauthorized" ||
    error.code === "forbidden"
  );
}

function toOption(model: SDKModel): CursorModelOption | null {
  const id = model.id.trim();
  const displayName = model.displayName.trim();
  if (!id || !displayName) return null;
  return {
    id,
    display_name: displayName,
    description: model.description?.trim() || null,
  };
}

/**
 * Fetch the live model catalog for a Cursor credential. The SDK response is
 * account-scoped, so this must never be cached across users or key origins.
 */
export async function listCursorModelsForKey(
  apiKey: string,
): Promise<CursorModelOption[]> {
  let models: SDKModel[];
  try {
    models = await Cursor.models.list({ apiKey });
  } catch (error) {
    if (isAuthenticationFailure(error)) {
      throw new CursorModelCatalogError(
        "invalid_key",
        "Cursor rejected the API key",
      );
    }
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
