import "server-only";
import {
  deleteDeviceToken,
  listDeviceTokensForUser,
  type DeviceToken,
} from "@/lib/db/devices";
import {
  sendAlertToToken,
  shouldRemoveTokenForReason,
  type ApnsAlertPayload,
  type ApnsSendResult,
} from "@/lib/push";

/**
 * Push the user the moment their Whoop refresh chain dies (#287).
 *
 * Called by the refresh path in `token.ts` ONLY when
 * `setIntegrationNeedsReauth(..., true)` reports a real 0→1 transition, so
 * 1→1 (repeated failures on an already-dead chain) and 1→0 (recovery) never
 * reach this module.
 *
 * Gated by `WHOOP_REAUTH_PUSH` and DEFAULT-OFF:
 *   - unset / anything else → off: no-op.
 *   - `log`                 → log the would-send payload and the device
 *                             count; never contacts APNs.
 *   - `on`                  → send to every registered device token.
 *
 * Never logs device tokens or Whoop tokens. Never throws: a push failure
 * must not break the token refresh path that called it.
 */

export type ReauthPushMode = "off" | "log" | "on";

/** Deep-link target the iOS tap handler routes on (`PushRoute.swift`). */
export const REAUTH_PUSH_ROUTE = "settings/connectors";

/**
 * Minimum gap between two reauth pushes for the same user. A chain that
 * dies, gets reconnected, and dies again within this window (e.g. a bad
 * reconnect) produces two 0→1 transitions; the user only needs one buzz.
 */
export const REAUTH_PUSH_DEBOUNCE_MS = 10 * 60 * 1000;

export function reauthPushMode(
  env: Record<string, string | undefined> = process.env
): ReauthPushMode {
  const raw = (env.WHOOP_REAUTH_PUSH ?? "").trim().toLowerCase();
  if (raw === "on") return "on";
  if (raw === "log") return "log";
  return "off";
}

export function buildReauthPushPayload(): ApnsAlertPayload {
  return {
    title: "Coach",
    body: "Whoop disconnected — tap to reconnect.",
    sound: "default",
    custom: { route: REAUTH_PUSH_ROUTE, reason: "whoop_needs_reauth" },
  };
}

export type ReauthPushDeps = {
  listTokens: (userId: number) => DeviceToken[];
  send: (token: string, alert: ApnsAlertPayload) => Promise<ApnsSendResult>;
  deleteToken: (userId: number, token: string) => number;
  now: () => number;
  log: (msg: string) => void;
  env: Record<string, string | undefined>;
};

const defaultDeps: ReauthPushDeps = {
  listTokens: listDeviceTokensForUser,
  send: (token, alert) => sendAlertToToken(token, alert),
  deleteToken: deleteDeviceToken,
  now: () => Date.now(),
  log: (msg) => console.log(msg),
  env: process.env,
};

export type ReauthPushOutcome =
  | { status: "disabled" }
  | { status: "debounced" }
  | { status: "logged"; devices: number }
  | { status: "no_devices" }
  | { status: "sent"; devices: number; delivered: number; removed: number }
  | { status: "error" };

/**
 * userId → epoch ms of the last push (or log-mode would-send).
 *
 * Pinned on `globalThis` rather than module scope: Next can instantiate this
 * module once per route bundle (/api/sync, /api/whoop/webhook,
 * /api/whoop/refresh, …), and a per-bundle map would let two bundles each
 * pass the debounce for the same user. Process restart clears it, which is
 * fine — the DB-level 0→1 guard is the primary once-only gate; this only
 * absorbs quick flap-and-refail cycles.
 */
const DEBOUNCE_KEY = Symbol.for("whoop-dashboard.reauthPush.lastPushAt");
const globalStore = globalThis as unknown as Record<symbol, Map<number, number>>;
const lastPushAt: Map<number, number> =
  globalStore[DEBOUNCE_KEY] ?? (globalStore[DEBOUNCE_KEY] = new Map());

/** Test hook: forget debounce state between cases. */
export function resetReauthPushDebounce(): void {
  lastPushAt.clear();
}

export async function notifyWhoopNeedsReauth(
  userId: number,
  overrides: Partial<ReauthPushDeps> = {}
): Promise<ReauthPushOutcome> {
  const deps = { ...defaultDeps, ...overrides };
  try {
    const mode = reauthPushMode(deps.env);
    if (mode === "off") return { status: "disabled" };

    const now = deps.now();
    const last = lastPushAt.get(userId);
    if (last !== undefined && now - last < REAUTH_PUSH_DEBOUNCE_MS) {
      deps.log(`[reauth-push] debounced user_id=${userId} mode=${mode}`);
      return { status: "debounced" };
    }
    // Claim the slot before any await so two transitions racing through
    // the event loop can't both pass the debounce check.
    lastPushAt.set(userId, now);

    const payload = buildReauthPushPayload();
    const tokens = deps.listTokens(userId);

    if (mode === "log") {
      deps.log(
        `[reauth-push] log-only would-send user_id=${userId} devices=${tokens.length} payload=${JSON.stringify(payload)}`
      );
      return { status: "logged", devices: tokens.length };
    }

    if (tokens.length === 0) {
      deps.log(`[reauth-push] no devices user_id=${userId}`);
      return { status: "no_devices" };
    }

    let delivered = 0;
    let removed = 0;
    await Promise.all(
      tokens.map(async (row) => {
        try {
          const r = await deps.send(row.token, payload);
          if (r.ok) {
            delivered++;
          } else if (shouldRemoveTokenForReason(r)) {
            removed += deps.deleteToken(userId, row.token);
          }
        } catch (err) {
          deps.log(
            `[reauth-push] send error user_id=${userId}: ${err instanceof Error ? err.name : "unknown"}`
          );
        }
      })
    );
    deps.log(
      `[reauth-push] sent user_id=${userId} devices=${tokens.length} delivered=${delivered} removed=${removed}`
    );
    return { status: "sent", devices: tokens.length, delivered, removed };
  } catch (err) {
    deps.log(
      `[reauth-push] failed user_id=${userId}: ${err instanceof Error ? err.name : "unknown"}`
    );
    return { status: "error" };
  }
}
