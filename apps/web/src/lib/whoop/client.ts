import "server-only";
import { getValidAccessToken } from "./token";

const BASE_URL = "https://api.prod.whoop.com/developer";
const FETCH_TIMEOUT_MS = 15_000;
const PAGE_LIMIT = 25;

export class WhoopAuthError extends Error {}
export class WhoopUpstreamError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
export class WhoopNotFoundError extends Error {}
// Thrown when recovery.updated webhook id is not found in the first page of
// GET /v2/recovery — likely a scoring race; Whoop will retry.
export class WhoopRecoveryListMissError extends Error {}

function combineSignals(
  external: AbortSignal | undefined,
  timeoutMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  const ctrl = new AbortController();
  if (external.aborted) {
    ctrl.abort(external.reason);
    return ctrl.signal;
  }
  if (timeout.aborted) {
    ctrl.abort(timeout.reason);
    return ctrl.signal;
  }
  // Whichever fires first aborts the controller and removes the other listener
  // so a long-lived `external` signal doesn't accumulate dead handlers.
  const onExternal = () => {
    timeout.removeEventListener("abort", onTimeout);
    ctrl.abort(external.reason);
  };
  const onTimeout = () => {
    external.removeEventListener("abort", onExternal);
    ctrl.abort(timeout.reason);
  };
  external.addEventListener("abort", onExternal, { once: true });
  timeout.addEventListener("abort", onTimeout, { once: true });
  return ctrl.signal;
}

type GetOpts = {
  /**
   * Owner of the Whoop tokens for this call. Threaded explicitly so the
   * client never falls back to a hardcoded user id — every callsite is
   * forced to surface auth.
   */
  userId: number;
  signal?: AbortSignal;
  /**
   * Fired when this call originates a Whoop token refresh (proactive on
   * expiry or 401-retry). Does NOT fire when the call joins an in-flight
   * refresh from another caller — see `getValidAccessToken`.
   */
  onTokenRefresh?: () => void;
};

export async function whoopGet<T>(path: string, opts: GetOpts): Promise<T> {
  const url = `${BASE_URL}${path}`;
  let token = await getValidAccessToken(opts.userId, false, { onRefresh: opts.onTokenRefresh });
  if (!token) throw new WhoopAuthError("No valid Whoop token; re-auth required");

  let resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    signal: combineSignals(opts.signal, FETCH_TIMEOUT_MS),
  });

  if (resp.status === 401) {
    token = await getValidAccessToken(opts.userId, true, { onRefresh: opts.onTokenRefresh });
    if (!token) throw new WhoopAuthError("Refresh failed; re-auth required");
    resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: combineSignals(opts.signal, FETCH_TIMEOUT_MS),
    });
  }

  if (resp.status === 404) {
    throw new WhoopNotFoundError(`Whoop 404: ${path}`);
  }
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new WhoopUpstreamError(
      `Whoop ${resp.status}: ${path} ${body.slice(0, 200)}`,
      resp.status,
    );
  }
  return (await resp.json()) as T;
}

/**
 * Whoop user profile (subset). The `user_id` field is the remote identifier
 * Whoop uses in webhook events — we persist it in `integrations.provider_user_id`
 * so future events can be routed to the right local user. Mirrors
 * `streamlit/whoop/client.py:get_profile()` which calls `/v2/user/profile/basic`.
 */
export type WhoopProfile = {
  user_id: number;
  email?: string;
  first_name?: string;
  last_name?: string;
};

export async function getWhoopProfile(opts: GetOpts): Promise<WhoopProfile> {
  return whoopGet<WhoopProfile>("/v2/user/profile/basic", opts);
}

type PaginatedResponse<T> = { records?: T[]; next_token?: string | null };

/** Page through a Whoop list endpoint, mirrors WhoopClient._get_all in Python. */
export async function whoopGetAll<T>(
  endpoint: string,
  params: Record<string, string>,
  opts: GetOpts,
): Promise<{ records: T[]; pageCount: number }> {
  const records: T[] = [];
  let pageCount = 0;
  let nextToken: string | null | undefined;

  // Whoop uses ?nextToken= for pagination. Include `limit=25` to match the
  // Python client's request shape exactly.
  while (true) {
    if (opts.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const usp = new URLSearchParams(params);
    usp.set("limit", String(PAGE_LIMIT));
    if (nextToken) usp.set("nextToken", nextToken);
    const data = await whoopGet<PaginatedResponse<T>>(
      `${endpoint}?${usp.toString()}`,
      opts,
    );
    pageCount += 1;
    if (data.records?.length) records.push(...data.records);
    nextToken = data.next_token ?? null;
    if (!nextToken) break;
  }
  return { records, pageCount };
}
