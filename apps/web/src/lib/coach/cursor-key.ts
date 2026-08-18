import "server-only";

import { getUserSettings } from "@/lib/db";
import {
  CursorModelCatalogError,
  listCursorModelsForKey,
} from "./cursor-models";
import { MissingCursorKeyError, type CursorKeyOrigin } from "./cursor-errors";
export {
  CursorAgentError,
  MissingCursorKeyError,
  type CursorFailureReason,
  type CursorKeyOrigin,
} from "./cursor-errors";

export type ResolvedCursorKey = {
  key: string;
  origin: CursorKeyOrigin;
};
export type CursorKeyProbeResult = "ok" | "invalid_key" | "probe_failed";

/** Resolve a user's Cursor key. Personal BYOK wins; the server key is fallback. */
export function resolveCursorKey(userId: number): ResolvedCursorKey {
  const settings = getUserSettings(userId);
  if (settings?.cursor_key) {
    return { key: settings.cursor_key, origin: "user" };
  }
  const env = process.env.CURSOR_API_KEY;
  if (env) return { key: env, origin: "env" };
  throw new MissingCursorKeyError();
}

/**
 * Validate a Cursor key without spending a model turn. The model catalog
 * authenticates the key and returns the models available to that account.
 */
export async function probeCursorKey(
  key: string,
): Promise<CursorKeyProbeResult> {
  try {
    await listCursorModelsForKey(key);
    return "ok";
  } catch (error) {
    if (error instanceof CursorModelCatalogError) {
      return error.reason === "invalid_key" ? "invalid_key" : "probe_failed";
    }
    return "probe_failed";
  }
}
