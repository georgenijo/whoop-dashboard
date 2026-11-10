import "server-only";
import { listAnthropicModelsForKey } from "./anthropic-models";
import type { AnthropicModelOption } from "./anthropic-model-options";
import { resolveConfiguredModel } from "./model-defaults";

/**
 * Resolve a configured background-generation model ID (chat titles, daily
 * insights — issue #587) against the live account catalog. Unlike the chat
 * loop's strict check, a failed catalog probe is not fatal here: the
 * configured ID goes out unverified and the request itself surfaces any
 * problem, so background generation only degrades, never blocks.
 */
export async function resolveCatalogModel(
  apiKey: string,
  configured: string,
): Promise<{ model: string; option: AnthropicModelOption | null }> {
  let catalog: AnthropicModelOption[];
  try {
    catalog = await listAnthropicModelsForKey(apiKey);
  } catch {
    return { model: configured, option: null };
  }
  return resolveConfiguredModel(catalog, configured);
}
