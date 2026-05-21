import { APIError, APIConnectionError } from "@anthropic-ai/sdk";
import { BadApiKeyError } from "./api-key";

export type ChatErrorKind =
  | "bad_api_key"
  | "quota_exceeded"
  | "rate_limited"
  | "overloaded"
  | "upstream_error"
  | "network_error"
  | "server_error";

export interface ClassifiedChatError {
  status: number;
  kind: ChatErrorKind;
  message: string;
  origin?: string;
}

function isCreditBalanceError(err: APIError): boolean {
  if (err.status !== 400) return false;
  const body = err.error as { error?: { message?: string } } | undefined;
  const msg = body?.error?.message ?? err.message ?? "";
  return /credit balance/i.test(msg);
}

export function classifyChatError(err: unknown): ClassifiedChatError {
  if (err instanceof BadApiKeyError) {
    return {
      status: 401,
      kind: "bad_api_key",
      message:
        err.origin === "user"
          ? "Your Anthropic API key was rejected. Update it in Settings."
          : "The server's Anthropic API key was rejected. Add a personal key in Settings.",
      origin: err.origin,
    };
  }

  if (err instanceof APIError) {
    if (isCreditBalanceError(err)) {
      return {
        status: 402,
        kind: "quota_exceeded",
        message:
          "Anthropic credits exhausted. Top up your Anthropic account, or add a personal key in Settings.",
      };
    }
    if (err.status === 429) {
      return {
        status: 429,
        kind: "rate_limited",
        message: "Rate limited by Anthropic. Try again in a moment.",
      };
    }
    if (err.status === 529) {
      return {
        status: 503,
        kind: "overloaded",
        message: "Anthropic is overloaded right now. Try again shortly.",
      };
    }
    if (typeof err.status === "number" && err.status >= 500) {
      return {
        status: 502,
        kind: "upstream_error",
        message: "Anthropic returned an error. Try again.",
      };
    }
  }

  if (err instanceof APIConnectionError) {
    return {
      status: 503,
      kind: "network_error",
      message: "Couldn't reach Anthropic. Check your connection and try again.",
    };
  }

  return {
    status: 500,
    kind: "server_error",
    message: "Coach call failed. Please try again.",
  };
}
