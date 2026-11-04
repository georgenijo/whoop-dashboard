import "server-only";
import { createHash } from "node:crypto";
import Anthropic, { APIError } from "@anthropic-ai/sdk";
import type { ModelInfo } from "@anthropic-ai/sdk/resources/models";
import type { AnthropicModelOption } from "./anthropic-model-options";
import type { CoachEffort } from "./provider";

export class AnthropicModelCatalogError extends Error {
  constructor(public readonly reason: "invalid_key" | "unavailable") {
    super(`Anthropic model catalog ${reason}`);
    this.name = "AnthropicModelCatalogError";
  }
}

export class AnthropicModelUnavailableError extends Error {
  constructor() {
    super("The selected Anthropic model is no longer available. Choose a model in Settings.");
    this.name = "AnthropicModelUnavailableError";
  }
}

const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 64;
const cache = new Map<string, {
  expiresAt: number;
  models: Promise<AnthropicModelOption[]>;
}>();

export function anthropicModelOption(model: ModelInfo): AnthropicModelOption {
  const capabilities = model.capabilities;
  let thinking: AnthropicModelOption["thinking"] = "none";
  let efforts: CoachEffort[] = ["off"];
  if (capabilities?.thinking.supported) {
    thinking = capabilities.thinking.types.adaptive.supported
      ? "adaptive"
      : capabilities.thinking.types.enabled.supported ? "enabled" : "none";
    if (thinking === "adaptive") {
      efforts = ["off", ...(["low", "medium", "high", "xhigh", "max"] as const)
        .filter((effort) => capabilities.effort.supported &&
          capabilities.effort[effort]?.supported)];
      // Adaptive thinking without an effort control still supports on/off.
      if (efforts.length === 1) efforts.push("high");
    } else if (thinking === "enabled") {
      // Older Claude models use token budgets rather than output_config.
      efforts = ["off", "low", "medium", "high"];
    }
  }
  // Older Models API responses omit capabilities. Only known model families
  // get a compatibility profile; unknown models receive no thinking fields.
  if (!capabilities) {
    if (/^claude-(sonnet|opus)-4-6(?:$|-)/.test(model.id)) {
      thinking = "adaptive";
      efforts = ["off", "low", "medium", "high"];
      if (model.id.startsWith("claude-opus-")) efforts.push("max");
    } else if (/^claude-(?:sonnet-4(?:-5)?|opus-4(?:-1|-5)?|haiku-4-5|3-7-sonnet)(?:$|-)/.test(model.id)) {
      thinking = "enabled";
      efforts = ["off", "low", "medium", "high"];
    }
  }
  return {
    id: model.id,
    display_name: model.display_name,
    thinking,
    efforts,
    max_tokens: model.max_tokens ?? null,
    output_effort: capabilities ? capabilities.effort.supported : thinking === "adaptive",
    strict_tools: capabilities?.structured_outputs?.supported ?? false,
  };
}

/** Account-scoped, paginated discovery. Cache identities never contain keys. */
export async function listAnthropicModelsForKey(apiKey: string): Promise<AnthropicModelOption[]> {
  const identity = createHash("sha256").update(apiKey).digest("hex");
  const existing = cache.get(identity);
  if (existing && existing.expiresAt > Date.now()) return existing.models;
  cache.delete(identity);
  while (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  const models = (async () => {
    try {
      const client = new Anthropic({ apiKey, timeout: 15_000, maxRetries: 0 });
      const result: AnthropicModelOption[] = [];
      for await (const model of client.models.list({ limit: 100 })) {
        result.push(anthropicModelOption(model));
      }
      return result;
    } catch (error) {
      // Do not retain failed probes or expose upstream messages/credentials.
      throw new AnthropicModelCatalogError(
        error instanceof APIError && (error.status === 401 || error.status === 403)
          ? "invalid_key" : "unavailable",
      );
    }
  })();
  cache.set(identity, { expiresAt: Date.now() + CACHE_TTL_MS, models });
  void models.catch(() => {
    if (cache.get(identity)?.models === models) cache.delete(identity);
  });
  return models;
}
