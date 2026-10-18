import "server-only";

import type { MorningBrief } from "@/lib/db/morning-brief";

const DEFAULT_TIMEOUT_MS = 10_000;

export class MorningWebhookConfigurationError extends Error {
  constructor() {
    super("Invalid Home Assistant webhook configuration");
    this.name = "MorningWebhookConfigurationError";
  }
}

export class MorningWebhookPublishError extends Error {
  constructor() {
    super("Home Assistant webhook publish failed");
    this.name = "MorningWebhookPublishError";
  }
}

export function validateMorningWebhookUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MorningWebhookConfigurationError();
  }
  const isLiteralLoopback = url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  const pathParts = url.pathname.split("/").filter(Boolean);
  if (
    url.protocol !== "http:" ||
    !isLiteralLoopback ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    pathParts.length !== 3 ||
    pathParts[0] !== "api" ||
    pathParts[1] !== "webhook" ||
    pathParts[2].length === 0
  ) {
    throw new MorningWebhookConfigurationError();
  }
  return url;
}

export async function publishMorningBrief(
  webhookUrl: string,
  brief: MorningBrief,
  options: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  const url = validateMorningWebhookUrl(webhookUrl);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new MorningWebhookConfigurationError();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ brief }),
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok || response.status < 200 || response.status >= 300) {
      throw new MorningWebhookPublishError();
    }
  } catch (error) {
    if (error instanceof MorningWebhookConfigurationError) throw error;
    if (error instanceof MorningWebhookPublishError) throw error;
    throw new MorningWebhookPublishError();
  } finally {
    clearTimeout(timeout);
  }
}
