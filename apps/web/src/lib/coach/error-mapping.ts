import { APIError, APIConnectionError, APIConnectionTimeoutError } from "@anthropic-ai/sdk";
import { BadApiKeyError } from "./api-key";
import { CursorAgentError, MissingCursorKeyError } from "./cursor-key";
import { CursorInsufficientMemoryError } from "./cursor-memory";
import { AnthropicModelCatalogError, AnthropicModelUnavailableError } from "./anthropic-models";

export type ChatErrorKind =
  | "bad_api_key"
  | "quota_exceeded"
  | "rate_limited"
  | "overloaded"
  | "upstream_error"
  | "network_error"
  | "server_error";

/**
 * Finer-grained failure class, additive to `kind` (which existing clients
 * already switch on). The web Coach uses it to pick an actionable message and
 * decide whether a Retry is worth offering; absent means "generic failure".
 */
export type ChatErrorReason =
  | "missing_key"
  | "invalid_key"
  | "model_unavailable"
  | "overloaded"
  | "timeout"
  | "quota"
  | "network"
  | "out_of_memory";

export interface ClassifiedChatError {
  status: number;
  kind: ChatErrorKind;
  message: string;
  origin?: string;
  reason?: ChatErrorReason;
}

function isCreditBalanceError(err: APIError): boolean {
  if (err.status !== 400) return false;
  const body = err.error as { error?: { message?: string } } | undefined;
  const msg = body?.error?.message ?? err.message ?? "";
  return /credit balance/i.test(msg);
}

export function classifyChatError(err: unknown): ClassifiedChatError {
  if (err instanceof AnthropicModelUnavailableError) {
    return { status: 422, kind: "upstream_error", reason: "model_unavailable", message: err.message };
  }
  if (err instanceof AnthropicModelCatalogError) {
    return { status: 503, kind: "upstream_error", reason: "model_unavailable", message: "Anthropic model discovery is unavailable. Try again shortly." };
  }
  if (err instanceof MissingCursorKeyError) {
    return {
      status: 503,
      kind: "server_error",
      reason: "missing_key",
      message:
        "The Cursor coach isn't configured. Switch to Claude in Settings, or contact the operator.",
    };
  }

  if (err instanceof CursorInsufficientMemoryError) {
    // Raised before spawn, so nothing ran and nothing was stored. Retrying
    // immediately hits the same ceiling — say so instead of "Try again".
    return {
      status: 503,
      kind: "server_error",
      reason: "out_of_memory",
      message:
        "The server is low on memory, so the Cursor coach didn't start. Switch to a Claude model, or try again in a few minutes.",
    };
  }

  if (err instanceof CursorAgentError) {
    if (err.reason === "auth") {
      return {
        status: err.origin === "user" ? 401 : 502,
        kind: err.origin === "user" ? "bad_api_key" : "upstream_error",
        reason: "invalid_key",
        message:
          err.origin === "user"
            ? "Your Cursor API key was rejected. Update it in Settings."
            : "The server's Cursor API key was rejected. Add a personal key in Settings.",
        origin: err.origin,
      };
    }
    if (err.reason === "timeout") {
      return {
        status: 504,
        kind: "upstream_error",
        reason: "timeout",
        message: "The Cursor coach took too long. Try again.",
      };
    }
    const signal = err.exit?.code === null ? err.exit.signal : null;
    if (signal) {
      // The subprocess died by signal before replying (issue #475-C). Say
      // which one: SIGKILL with no timeout is almost always the kernel or the
      // service cgroup reclaiming memory, which a user can't fix by resending
      // immediately; anything else (SIGSEGV, SIGABRT, …) is a CLI crash.
      return {
        status: 502,
        kind: "upstream_error",
        message:
          signal === "SIGKILL"
            ? "The Cursor coach process was killed (SIGKILL) before it replied — the server may be short on memory. Try again in a moment."
            : `The Cursor coach process crashed (${signal}) before it replied. Try again.`,
      };
    }
    return {
      status: 502,
      kind: "upstream_error",
      message: "The Cursor coach hit an error. Try again.",
    };
  }

  if (err instanceof BadApiKeyError) {
    return {
      status: 401,
      kind: "bad_api_key",
      reason: "invalid_key",
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
        reason: "quota",
        message:
          "Anthropic credits exhausted. Top up your Anthropic account, or add a personal key in Settings.",
      };
    }
    if (err.status === 429) {
      return {
        status: 429,
        kind: "rate_limited",
        reason: "overloaded",
        message: "Rate limited by Anthropic. Try again in a moment.",
      };
    }
    if (err.status === 529) {
      return {
        status: 503,
        kind: "overloaded",
        reason: "overloaded",
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

  if (err instanceof APIConnectionTimeoutError) {
    return {
      status: 504,
      kind: "network_error",
      reason: "timeout",
      message: "Anthropic took too long to respond. Try again.",
    };
  }

  if (err instanceof APIConnectionError) {
    return {
      status: 503,
      kind: "network_error",
      reason: "network",
      message: "Couldn't reach Anthropic. Check your connection and try again.",
    };
  }

  return {
    status: 500,
    kind: "server_error",
    message: "Coach call failed. Please try again.",
  };
}
