import "server-only";

import {
  getCredentialHealth,
  saveCredentialHealth,
  type CredentialHealthRow,
  type CredentialHealthStatus,
} from "@/lib/db/credential-health";
import { forModule } from "@/lib/logger";
import {
  CursorModelCatalogError,
  listCursorModelsViaHttp,
} from "./cursor-models";

// Issue #525 — periodic health probe for the shared server-side
// CURSOR_API_KEY. BYOK keys are validated at submission
// (/api/me/cursor-key); the shared fallback key was never checked, so a
// revoked key (#442) was discovered by a user's failed Coach turn.
//
// Scheduling: no new daemon. The existing 30-minute keepalive timer
// (systemd/whoop-web-refresh.timer → POST /api/whoop/refresh, #273) calls
// runSharedKeyProbe() alongside its Whoop token refresh fan-out.
//
// Check: `GET https://api.cursor.com/v1/models` with the key as bearer —
// the same authenticated catalog call the BYOK submission probe and the
// official Cursor SDK's `Cursor.models.list()` make. It authenticates the
// key and lists models; it does not run an agent or spend a model turn.
// Always the plain HTTPS path (never ACP), so the probe never spawns a
// cursor-agent process.
//
// Default off: does nothing unless COACH_KEY_PROBE=on.
//
// Secrecy: the key is passed to the catalog fetch and nowhere else. Logs,
// the credential_health row, the incident payload and the probe result
// carry only a status, timestamps and fixed descriptive strings.

type ProbeEnv = Record<string, string | undefined>;

export const SHARED_CURSOR_CREDENTIAL = "cursor_shared_key";

/** Consecutive `invalid` results before an incident opens. One 401/403 can
 *  be an upstream blip; two in a row (≥30 min apart on the timer cadence) is
 *  a dead credential. */
export const INVALID_INCIDENT_THRESHOLD = 2;

const log = forModule("coach.key-probe");

export function isSharedKeyProbeEnabled(
  env: ProbeEnv = process.env,
): boolean {
  return env.COACH_KEY_PROBE?.trim().toLowerCase() === "on";
}

const DETAIL: Record<CredentialHealthStatus, string> = {
  ok: "Cursor accepted the shared key (model catalog listed)",
  invalid: "Cursor rejected the shared key (HTTP 401/403 from /v1/models)",
  unreachable:
    "Cursor model catalog unreachable or returned an unexpected response",
};

/** Map a catalog call outcome to a probe status. `null` means success. */
export function classifyProbeOutcome(error: unknown): CredentialHealthStatus {
  if (error === null) return "ok";
  if (
    error instanceof CursorModelCatalogError &&
    error.reason === "invalid_key"
  ) {
    return "invalid";
  }
  return "unreachable";
}

// ---------------------------------------------------------------------------
// Incident hook point.
//
// The #444 failure-alert mechanism (PR #645) is not on main, so this module
// does not import it. Instead it exposes a registry: whatever alerting layer
// lands later calls `registerSharedCredentialIncidentHandler(fn)` once at
// startup. Handlers fire exactly once per incident — on the transition into
// a sustained-invalid state ("opened") and once on recovery ("resolved") —
// never on every 30-minute repeat of the same invalid result.
//
// The registry lives on globalThis (not module scope) because Next bundles
// route entries separately; a handler registered from one bundle must be
// seen by the keepalive route's copy of this module.
// ---------------------------------------------------------------------------

export type SharedCredentialIncident = {
  kind: "shared_credential_invalid";
  credential: typeof SHARED_CURSOR_CREDENTIAL;
  phase: "opened" | "resolved";
  consecutive_invalid: number;
  last_ok: string | null;
  at: string;
};

export type SharedCredentialIncidentHandler = (
  incident: SharedCredentialIncident,
) => void | Promise<void>;

const HANDLERS_KEY = Symbol.for("whoop-dashboard.shared-key-probe.handlers");

function handlers(): Set<SharedCredentialIncidentHandler> {
  const g = globalThis as unknown as Record<
    symbol,
    Set<SharedCredentialIncidentHandler> | undefined
  >;
  return (g[HANDLERS_KEY] ??= new Set());
}

/** Register an incident handler. Returns an unregister function. */
export function registerSharedCredentialIncidentHandler(
  handler: SharedCredentialIncidentHandler,
): () => void {
  handlers().add(handler);
  return () => {
    handlers().delete(handler);
  };
}

async function emitIncident(incident: SharedCredentialIncident): Promise<void> {
  for (const handler of handlers()) {
    try {
      await handler(incident);
    } catch (err) {
      log.error(
        {
          phase: incident.phase,
          err: err instanceof Error ? err.message : String(err),
        },
        "shared credential incident handler threw",
      );
    }
  }
}

// ---------------------------------------------------------------------------

export type SharedKeyProbeResult =
  | { ran: false; reason: "disabled" | "no_shared_key" }
  | {
      ran: true;
      status: CredentialHealthStatus;
      last_checked: string;
      last_ok: string | null;
      consecutive_invalid: number;
      incident: "opened" | "resolved" | null;
    };

/** Next persisted state given the previous row and a fresh status. Pure. */
export function nextCredentialHealth(
  prev: CredentialHealthRow | null,
  status: CredentialHealthStatus,
  nowIso: string,
): { row: CredentialHealthRow; incident: "opened" | "resolved" | null } {
  const prevInvalid = prev?.consecutive_invalid ?? 0;
  const prevOpen = prev?.incident_open ?? false;

  // `unreachable` says nothing about the key, so it neither advances nor
  // resets the invalid streak and never opens or closes an incident.
  const consecutive_invalid =
    status === "invalid" ? prevInvalid + 1 : status === "ok" ? 0 : prevInvalid;

  let incident_open = prevOpen;
  let incident: "opened" | "resolved" | null = null;
  if (
    status === "invalid" &&
    !prevOpen &&
    consecutive_invalid >= INVALID_INCIDENT_THRESHOLD
  ) {
    incident_open = true;
    incident = "opened";
  } else if (status === "ok" && prevOpen) {
    incident_open = false;
    incident = "resolved";
  }

  return {
    row: {
      credential: SHARED_CURSOR_CREDENTIAL,
      status,
      last_checked: nowIso,
      last_ok: status === "ok" ? nowIso : (prev?.last_ok ?? null),
      consecutive_invalid,
      incident_open,
      detail: DETAIL[status],
    },
    incident,
  };
}

/**
 * Probe the shared CURSOR_API_KEY once and persist the result. Never throws.
 * No-op (no network, no DB write) unless COACH_KEY_PROBE=on.
 */
export async function runSharedKeyProbe(
  opts: { env?: ProbeEnv; now?: () => Date } = {},
): Promise<SharedKeyProbeResult> {
  const env = opts.env ?? process.env;
  if (!isSharedKeyProbeEnabled(env)) return { ran: false, reason: "disabled" };
  const key = env.CURSOR_API_KEY?.trim();
  if (!key) return { ran: false, reason: "no_shared_key" };

  let outcome: unknown = null;
  try {
    await listCursorModelsViaHttp(key);
  } catch (err) {
    outcome = err;
  }
  const status = classifyProbeOutcome(outcome);
  const nowIso = (opts.now?.() ?? new Date()).toISOString();

  let prev: CredentialHealthRow | null = null;
  try {
    prev = getCredentialHealth(SHARED_CURSOR_CREDENTIAL);
  } catch {
    prev = null;
  }
  const { row, incident } = nextCredentialHealth(prev, status, nowIso);

  try {
    saveCredentialHealth(row);
  } catch (err) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "failed to persist shared key probe result",
    );
  }

  const fields = {
    status,
    consecutive_invalid: row.consecutive_invalid,
    last_ok: row.last_ok,
  };
  if (status === "ok") {
    log.info(fields, "shared cursor key probe ok");
  } else if (status === "unreachable") {
    log.warn(fields, "shared cursor key probe could not reach Cursor");
  } else if (incident === "opened" || prev?.status !== "invalid") {
    // Error-level only on the first invalid result and when the incident
    // opens; repeats while the incident is open stay at info so a dead key
    // does not write 48 warn+ server_logs rows a day.
    log.error(fields, "shared cursor key rejected by Cursor");
  } else {
    log.info(fields, "shared cursor key still rejected (incident open)");
  }

  if (incident) {
    await emitIncident({
      kind: "shared_credential_invalid",
      credential: SHARED_CURSOR_CREDENTIAL,
      phase: incident,
      consecutive_invalid: row.consecutive_invalid,
      last_ok: row.last_ok,
      at: nowIso,
    });
  }

  return {
    ran: true,
    status,
    last_checked: row.last_checked,
    last_ok: row.last_ok,
    consecutive_invalid: row.consecutive_invalid,
    incident,
  };
}
