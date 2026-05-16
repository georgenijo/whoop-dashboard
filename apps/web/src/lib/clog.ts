"use client";

// Issue #389 — fire-and-forget client logger. POSTs to /api/log/client.
// Never blocks the caller, never throws, never logs failures (would loop).

type Level = "info" | "warn" | "error";
type Kind = "error" | "pageview" | "click" | "lifecycle" | "event";

type Payload = {
  source: "web";
  level: Level;
  kind: Kind;
  message: string;
  details?: Record<string, unknown>;
};

const MESSAGE_MAX = 1024;
const DETAILS_MAX = 4096;

function send(payload: Payload): void {
  if (typeof window === "undefined") return;
  setTimeout(() => {
    try {
      const body: Payload = {
        ...payload,
        message: payload.message.slice(0, MESSAGE_MAX),
      };
      if (payload.details) {
        const serialized = JSON.stringify(payload.details);
        if (serialized.length > DETAILS_MAX) {
          body.details = { truncated: serialized.slice(0, DETAILS_MAX) };
        }
      }
      void fetch("/api/log/client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
        credentials: "same-origin",
      }).catch(() => {});
    } catch {
      // swallow
    }
  }, 0);
}

export const clog = {
  info(message: string, details?: Record<string, unknown>): void {
    send({ source: "web", level: "info", kind: "event", message, details });
  },
  warn(message: string, details?: Record<string, unknown>): void {
    send({ source: "web", level: "warn", kind: "error", message, details });
  },
  error(message: string, details?: Record<string, unknown>): void {
    send({ source: "web", level: "error", kind: "error", message, details });
  },
  event(kind: Kind, details: Record<string, unknown>, message?: string): void {
    send({
      source: "web",
      level: "info",
      kind,
      message: message ?? kind,
      details,
    });
  },
};
